using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using NcSender.Server.Protocols.FluidNc;
using NcSender.Server.Protocols.Grbl;
using NcSender.Server.Protocols.GrblHal;

namespace NcSender.Server.Tests;

/// <summary>
/// FluidNC through the whole controller: lines recorded from FluidNC v4.0.3
/// in, and the state ncSender ends up with must be what grblHAL would give.
/// </summary>
public class CncControllerFluidNcTests : IDisposable
{
    private const string Greeting = "Grbl 4.0 [FluidNC v4.0.3 (homing-phase-stallguard-bbfffdc9) (esp32-wifi) '$' for help]";

    private readonly CncController _controller;
    private readonly FakeTransport _transport = new();
    private readonly List<string> _data = [];

    public CncControllerFluidNcTests()
    {
        _controller = new CncController(
            NullLogger<CncController>.Instance,
            new Mock<ISettingsManager>().Object,
            [new GrblProtocol { ToolFile = null }, new GrblHalProtocol(), new FluidNcProtocol()],
            new Mock<IDongleDeviceService>().Object);
        SetPrivate(_controller, "_transport", _transport);
        SetPrivate(_controller, "IsConnected", true);
        InvokePrivate(_controller, "StartQueueConsumer");
        _controller.DataReceived += (d, _) => { lock (_data) _data.Add(d); };
        _controller.HandleIncomingData(Greeting);
        Settle().GetAwaiter().GetResult();
    }

    // After ncSender's connect reset the first line reads the units and the
    // tool length offset back before it goes out (FluidNcTranslator).
    private async Task Settle()
    {
        var first = _controller.SendCommandAsync("G4 P0", Plugin());
        await WaitForWrite("$G\n");
        Feed("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Feed("ok");
        await WaitForWrite("$#\n");
        Feed("[TLO:0.000,0.000,0.000]");
        Feed("ok");
        await WaitForWrite("G4 P0\n");
        Feed("ok");
        await Done(first);
        lock (_transport.WriteLog) _transport.WriteLog.Clear();
    }

    public void Dispose()
    {
        InvokePrivate(_controller, "StopPolling");
        InvokePrivate(_controller, "StopQueueConsumer");
    }

    private static CommandOptions Plugin() => new() { Meta = new CommandMeta { SourceId = "plugin" } };
    private static CommandOptions Job() => new() { Meta = new CommandMeta { SourceId = "job" } };

    private void Feed(string line) => _controller.HandleIncomingData(line);

    private string[] Writes() { lock (_transport.WriteLog) return [.. _transport.WriteLog]; }
    private string[] Data() { lock (_data) return [.. _data]; }

    private async Task WaitForWrite(string expected)
    {
        for (var i = 0; i < 80; i++)
        {
            if (Writes().Contains(expected)) return;
            await Task.Delay(25);
        }
        Assert.Fail($"transport never received {expected.Replace("\n", "\\n")}; got: {string.Join(" | ", Writes()).Replace("\n", "\\n")}");
    }

    private static async Task<CommandResult> Done(Task<CommandResult> task)
    {
        Assert.Same(task, await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(3))));
        return await task;
    }

    private MachineState State => _controller.LastStatus;

    [Fact]
    public void Status_WithoutHomedField_ReadsHomed()
    {
        Feed("<Idle|MPos:105.000,-100.000,-5.000|FS:0,0>");
        Assert.True(State.Homed);
        Assert.Equal("XYZ", State.Axes);
    }

    [Fact]
    public void Status_UsesFluidNcsOwnWco_AndKeepsItBetweenReports()
    {
        Feed("<Idle|MPos:105.000,-100.000,-5.000|FS:0,0|WCO:68.284,-379.903,-39.500>");
        Feed("<Idle|MPos:106.000,-100.000,-5.000|FS:0,0>");
        Assert.Equal("68.284,-379.903,-39.500", State.WCO);
        Assert.Equal("37.716,279.903,34.500", State.WPos);
    }

    // The #66 follow-up: the tool length offset was never read as set on
    // FluidNC, so the tool setter ran at every job start.
    // ncSender's connect reset left the measured tool's offset in $# but not
    // applied: it goes back before anything else runs.
    [Fact]
    public async Task Reset_PutsTheToolLengthOffsetBack()
    {
        _controller.HandleIncomingData(Greeting);   // a reset: the greeting again
        var line = _controller.SendCommandAsync("G0 X1", Plugin());
        await WaitForWrite("$G\n");
        Feed("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Feed("ok");
        await WaitForWrite("$#\n");
        Feed("[TLO:0.000,0.000,-109.500]");
        Feed("ok");
        await WaitForWrite("G43.1 Z-109.5\n");
        Feed("ok");
        await WaitForWrite("G0 X1\n");
        Feed("ok");
        Assert.Equal("success", (await Done(line)).Status);
    }

    [Fact]
    public async Task ToolOffsetQuery_AfterAMeasure_SetsToolLengthSet()
    {
        var set = _controller.SendCommandAsync("G43.1 Z2.25", Plugin());
        await WaitForWrite("G43.1 Z2.25\n");
        Feed("ok");
        await Done(set);
        var query = _controller.SendCommandAsync("$#=_tool_offset", Plugin());
        await WaitForWrite("$#\n");
        Feed("[G54:68.284,-379.903,-39.500]");
        Feed("[G92:0.000,0.000,0.000]");
        Feed("[TLO:0.000,0.000,2.250]");
        Feed("ok");
        Assert.Equal("success", (await Done(query)).Status);
        Assert.True(State.ToolLengthSet);
        Assert.Contains("[PARAM:_TOOL_OFFSET=1]", Data());
    }

    [Fact]
    public async Task OverrideControl_NeverReachesFluidNc()
    {
        var seq = _controller.SendCommandAsync("#<return_spov> = #<_speed_override>\nM51 P0\nG4 P0\nM51 P[#<return_spov>]", Plugin());
        await WaitForWrite("#<return_spov> = #<_speed_override>\n");
        Feed("ok");
        await WaitForWrite("G4 P0\n");
        Feed("ok");
        Assert.Equal("success", (await Done(seq)).Status);
        Assert.DoesNotContain(Writes(), w => w.Contains("M51"));
    }

    [Fact]
    public async Task JobLine_GoesOutOnTheNormalPath()
    {
        var line = _controller.SendCommandAsync("G1 X5 F500", Job());
        await WaitForWrite("G1 X5 F500\n");
        Feed("ok");
        Assert.Equal("success", (await Done(line)).Status);
    }

    [Fact]
    public async Task MsgComment_EchoFiresTheSentinels()
    {
        var line = _controller.SendCommandAsync("(MSG, TOOL_CHANGE_START 3)", Plugin());
        await WaitForWrite("(MSG, TOOL_CHANGE_START 3)\n");
        Feed("[MSG:INFO: MSG, TOOL_CHANGE_START 3]");
        Feed("ok");
        Assert.Equal("success", (await Done(line)).Status);
        Assert.Contains("[MSG:TOOL_CHANGE_START 3]", Data());
    }

    [Fact]
    public void SpindleChatter_NeverReachesTheTerminal()
    {
        Feed("<Run|MPos:0,0,0|FS:500,6000>");
        Feed("[MSG:INFO: Syncing to 6000]");
        Feed("[MSG:INFO: Current speed is 5982]");
        Feed("<Run|MPos:0,0,0|FS:500,6000>");
        Assert.DoesNotContain(Data(), d => d.Contains("speed", StringComparison.OrdinalIgnoreCase) || d.Contains("Syncing"));
        Assert.Equal(5982, State.SpindleRpmActual);
        Assert.Equal(6000, State.SpindleRpmTarget);
    }

    [Fact]
    public async Task ToolChange_ReadsTheToolBackFromTheParserState()
    {
        var m61 = _controller.SendCommandAsync("M61 Q4", Plugin());
        await WaitForWrite("M61 Q4\n");
        Feed("ok");
        await Done(m61);
        await WaitForWrite("$G\n");
        Feed("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T4 F0 S0]");
        Feed("ok");
        Assert.Equal(4, State.Tool);
        Assert.Equal("G54", State.Workspace);
    }

    [Fact]
    public async Task WorkspaceChange_ReadsTheParserStateBack()
    {
        var g55 = _controller.SendCommandAsync("G55", Plugin());
        await WaitForWrite("G55\n");
        Feed("ok");
        await Done(g55);
        await WaitForWrite("$G\n");
        Feed("[GC:G0 G55 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Feed("ok");
        Assert.Equal("G55", State.Workspace);
    }

    [Fact]
    public async Task AlarmList_IsReadLikeGrblHals()
    {
        var list = _controller.SendCommandAsync("$EA", Plugin());
        await WaitForWrite("$A\n");
        Feed("1: Hard Limit");
        Feed("2: Soft Limit");
        Feed("ok");
        await Done(list);
        Assert.Contains("[ALARMCODE:2||Soft Limit]", Data());
    }

    [Fact]
    public async Task ProbeMove_WithMinusBeforeABracket_IsRewritten()
    {
        var move = _controller.SendCommandAsync("G0 X-[#<a>-#<b>]", Plugin());
        await WaitForWrite("G0 X[-[#<a>-#<b>]]\n");
        Feed("ok");
        Assert.Equal("success", (await Done(move)).Status);
    }

    private static void SetPrivate(object target, string name, object? value)
    {
        var type = target.GetType();
        var field = type.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);
        if (field is not null) { field.SetValue(target, value); return; }
        var prop = type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        if (prop is not null) { prop.SetValue(target, value); return; }
        throw new InvalidOperationException($"Field/property '{name}' not found on {type.Name}");
    }

    private static void InvokePrivate(object target, string name)
    {
        var method = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic);
        method?.Invoke(target, null);
    }

    private sealed class FakeTransport : IConnectionTransport
    {
        public readonly List<string> WriteLog = new();
        public bool IsConnected { get; private set; } = true;
        public string TransportType => "fake";
        public string PortPath => "fake://test";
        public Task ConnectAsync(CancellationToken ct = default) { IsConnected = true; return Task.CompletedTask; }
        public Task DisconnectAsync() { IsConnected = false; return Task.CompletedTask; }
        public Task WriteAsync(string data, CancellationToken ct = default)
        {
            lock (WriteLog) WriteLog.Add(data);
            return Task.CompletedTask;
        }
        public Task WriteRawAsync(byte[] data, CancellationToken ct = default) => Task.CompletedTask;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        public event Action<string>? LineReceived;
        public event Action<Exception?>? ConnectionLost;
        public void RaiseLineReceived(string line) => LineReceived?.Invoke(line);
        public void RaiseConnectionLost(Exception? ex) => ConnectionLost?.Invoke(ex);
    }
}
