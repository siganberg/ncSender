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
/// The controller picks classic Grbl from its greeting and sends every queued
/// line through the Grbl translator: a command becomes the lines Grbl can run,
/// each sent after the previous one's ok, and it completes once at the end.
/// grblHAL keeps sending lines exactly as before.
/// </summary>
public class CncControllerGrblTests : IDisposable
{
    private readonly CncController _controller;
    private readonly FakeTransport _transport = new();
    private readonly List<string> _data = [];

    public CncControllerGrblTests()
    {
        _controller = new CncController(
            NullLogger<CncController>.Instance,
            new Mock<ISettingsManager>().Object,
            [new GrblProtocol { ToolFile = null }, new GrblHalProtocol(), new FluidNcProtocol { ToolFile = null }],
            new Mock<IDongleDeviceService>().Object);
        SetPrivate(_controller, "_transport", _transport);
        SetPrivate(_controller, "IsConnected", true);
        InvokePrivate(_controller, "StartQueueConsumer");
        _controller.DataReceived += (d, _) => { lock (_data) _data.Add(d); };
    }

    public void Dispose()
    {
        InvokePrivate(_controller, "StopPolling");
        InvokePrivate(_controller, "StopQueueConsumer");
    }

    private static CommandOptions Plugin() => new() { Meta = new CommandMeta { SourceId = "plugin" } };

    private void Greet(string greeting) => _controller.HandleIncomingData(greeting);

    private string[] Writes() { lock (_transport.WriteLog) return [.. _transport.WriteLog]; }

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

    [Theory]
    [InlineData("Grbl 1.1h ['$' for help]", "Grbl")]
    [InlineData("Grbl 1.1f ['$' for help]", "Grbl")]
    [InlineData("GrblHAL 1.1f ['$' or '$HELP' for help]", "grblHAL")]
    [InlineData("Grbl 1.1f ['$' or '$HELP' for help]", "grblHAL")]
    [InlineData("Grbl 3.7 [FluidNC v3.7.18 (wifi) '$' for help]", "FluidNC")]
    public void Greeting_PicksTheProtocol(string greeting, string expected)
    {
        Greet(greeting);
        Assert.Equal(expected, _controller.ActiveProtocol?.Name);
        var translator = GetPrivate(_controller, "_translator");
        Assert.Equal(expected is "Grbl" or "FluidNC", translator is not null);
    }

    [Fact]
    public void GrblHalWithClassicGreeting_SwitchesWhenItListsNewOpt()
    {
        Greet("Grbl 1.1f ['$' for help]");
        Assert.Equal("Grbl", _controller.ActiveProtocol?.Name);
        _controller.HandleIncomingData("[NEWOPT:ENUMS,RT+,HOME,EXPR,TC]");
        Assert.Equal("grblHAL", _controller.ActiveProtocol?.Name);
        Assert.Null(GetPrivate(_controller, "_translator"));
    }

    [Fact]
    public async Task Grbl_EvaluatesEachLineAfterThePreviousReply()
    {
        Greet("Grbl 1.1h ['$' for help]");
        var seq = _controller.SendCommandAsync("#<d> = 2\nG91 G0 Z[#<d> * 2]\nG90", Plugin());

        await WaitForWrite("G91 G0 Z4\n");
        Assert.DoesNotContain("G90\n", Writes());
        _controller.HandleIncomingData("ok");
        await WaitForWrite("G90\n");
        Assert.False(seq.IsCompleted);
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(seq)).Status);
    }

    [Fact]
    public async Task Grbl_ProbeResultFeedsTheNextLine()
    {
        Greet("Grbl 1.1h ['$' for help]");
        var seq = _controller.SendCommandAsync(
            "G38.2 Z-10 F100\n#<hit> = #5070\no1 if [#<hit> EQ 1]\nG10 L20 P0 Z0\no1 endif", Plugin());

        await WaitForWrite("G38.2 Z-10 F100\n");
        _controller.HandleIncomingData("[PRB:0.000,0.000,-7.500:1]");
        _controller.HandleIncomingData("ok");
        await WaitForWrite("G10 L20 P0 Z0\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(seq)).Status);
    }

    [Fact]
    public async Task Grbl_ReadsOffsetsWithDollarHashBeforeUsingThem()
    {
        Greet("Grbl 1.1h ['$' for help]");
        var seq = _controller.SendCommandAsync("G0 Z[#5223 + 1]", Plugin());

        // Grbl only answers $# when Idle: the dwell lets motion finish first.
        await WaitForWrite("G4 P0\n");
        _controller.HandleIncomingData("ok");
        await WaitForWrite("$#\n");
        _controller.HandleIncomingData("[G54:0.000,0.000,-40.000]");
        _controller.HandleIncomingData("ok");
        await WaitForWrite("G0 Z-39\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(seq)).Status);
    }

    [Fact]
    public async Task Grbl_UnsupportedLine_FailsWithoutReachingTheController()
    {
        Greet("Grbl 1.1h ['$' for help]");
        var before = Writes().Length;
        var result = await Done(_controller.SendCommandAsync("M64 P1", Plugin()));
        Assert.Equal("error", result.Status);
        Assert.Contains("I/O", result.ErrorMessage);
        Assert.Equal(before, Writes().Length);
    }

    [Fact]
    public async Task Grbl_ControllerError_StopsTheRestOfTheCommand()
    {
        Greet("Grbl 1.1h ['$' for help]");
        var seq = _controller.SendCommandAsync("G0 X1\nG0 X2", Plugin());
        await WaitForWrite("G0 X1\n");
        _controller.HandleIncomingData("error:20");
        var result = await Done(seq);
        Assert.Equal("error", result.Status);
        Assert.Equal(20, result.ErrorCode);
        await Task.Delay(100);
        Assert.DoesNotContain("G0 X2\n", Writes());
    }

    [Fact]
    public async Task Grbl_MsgComment_IsReportedLikeAnEcho()
    {
        Greet("Grbl 1.1h ['$' for help]");
        var result = await Done(_controller.SendCommandAsync("(MSG, TOOL_CHANGE_START 3)", Plugin()));
        Assert.Equal("success", result.Status);
        lock (_data) Assert.Contains("[MSG:TOOL_CHANGE_START 3]", _data);
        Assert.DoesNotContain(Writes(), w => w.Contains("MSG"));
    }

    [Fact]
    public async Task Grbl_PlainLine_UsesTheNormalPath()
    {
        Greet("Grbl 1.1h ['$' for help]");
        var job = _controller.SendCommandAsync("G1 X5 F500", new CommandOptions { Meta = new CommandMeta { SourceId = "job" } });
        await WaitForWrite("G1 X5 F500\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(job)).Status);
    }

    // Shapeoko report: a held jog asks for the whole travel; the clamp must
    // learn $130-$132 from the controller's own $$ reply, or Grbl answers
    // error:15 and the machine never moves.
    [Fact]
    public async Task Grbl_HeldJog_IsShortenedToTheTravelFromDollarDollar()
    {
        Greet("Grbl 1.1h ['$' for help]");
        _controller.HandleIncomingData("$130=1237.000");
        _controller.HandleIncomingData("$131=1237.000");
        _controller.HandleIncomingData("$132=150.000");
        _controller.HandleIncomingData("<Home|MPos:-100.000,-100.000,-10.000|FS:0,0>");
        _controller.HandleIncomingData("<Idle|MPos:-100.000,-100.000,-10.000|FS:0,0>");

        var jog = _controller.SendCommandAsync("$J=G21 G91 Z145 F1500", new CommandOptions { Meta = new CommandMeta { SourceId = "client" } });
        await WaitForWrite("$J=G21 G91 Z9.99 F1500\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(jog)).Status);
    }

    // Unlocked with $X instead of homing: Grbl still checks soft limits, so
    // the held jog has to be shortened all the same.
    [Fact]
    public async Task Grbl_HeldJog_IsShortenedWhenUnlockedWithSoftLimitsOn()
    {
        Greet("Grbl 1.1f ['$' for help]");
        _controller.HandleIncomingData("$20=1");
        _controller.HandleIncomingData("$130=851.154");
        _controller.HandleIncomingData("<Idle|MPos:-100.000,-100.000,-10.000|FS:0,0>");

        var jog = _controller.SendCommandAsync("$J=G21 G91 X-851.154 F3000", new CommandOptions { Meta = new CommandMeta { SourceId = "client" } });
        await WaitForWrite("$J=G21 G91 X-751.144 F3000\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(jog)).Status);
    }

    // Soft limits off: Grbl doesn't check travel, nothing to shorten.
    [Fact]
    public async Task Grbl_HeldJog_IsLeftAloneWithSoftLimitsOff()
    {
        Greet("Grbl 1.1f ['$' for help]");
        _controller.HandleIncomingData("$20=0");
        _controller.HandleIncomingData("$130=851.154");
        _controller.HandleIncomingData("<Idle|MPos:-100.000,-100.000,-10.000|FS:0,0>");

        var jog = _controller.SendCommandAsync("$J=G21 G91 X-851.154 F3000", new CommandOptions { Meta = new CommandMeta { SourceId = "client" } });
        await WaitForWrite("$J=G21 G91 X-851.154 F3000\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(jog)).Status);
    }

    // $10=0/2: Grbl reports WPos only. Machine position is WPos + WCO, which
    // the clamp needs.
    [Fact]
    public async Task Grbl_HeldJog_IsShortenedFromAWorkPositionReport()
    {
        Greet("Grbl 1.1f ['$' for help]");
        _controller.HandleIncomingData("$20=1");
        _controller.HandleIncomingData("$130=851.154");
        _controller.HandleIncomingData("<Idle|WPos:22.070,7.274,2.836|FS:0,0|WCO:-122.070,-50.000,-20.000>");
        _controller.HandleIncomingData("<Idle|WPos:22.070,7.274,2.836|FS:0,0>");

        var jog = _controller.SendCommandAsync("$J=G21 G91 X851.154 F3000", new CommandOptions { Meta = new CommandMeta { SourceId = "client" } });
        await WaitForWrite("$J=G21 G91 X99.99 F3000\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(jog)).Status);
    }

    // Grbl takes its tool from each line's T word, so after a tool change the
    // next line without one makes $G read T0. The tool is the one ncSender set.
    [Fact]
    public async Task Grbl_ToolSurvivesLinesWithoutATWord()
    {
        Greet("Grbl 1.1f ['$' for help]");
        var seq = _controller.SendCommandAsync("M61 Q1\nG53 G0 Z-5", Plugin());
        await WaitForWrite("G4 P0\n");
        _controller.HandleIncomingData("ok");
        await WaitForWrite("T1\n");
        _controller.HandleIncomingData("ok");
        await WaitForWrite("G53 G0 Z-5\n");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(seq)).Status);

        _controller.HandleIncomingData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal(1, _controller.LastStatus.Tool);
    }

    [Fact]
    public async Task GrblHal_LinesGoOutUntouched()
    {
        Greet("GrblHAL 1.1f ['$' or '$HELP' for help]");
        var seq = _controller.SendCommandAsync("#<d> = 2\nG0 Z[#<d>]", Plugin());
        await WaitForWrite("#<d> = 2\nG0 Z[#<d>]\n");
        _controller.HandleIncomingData("ok");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(seq)).Status);
    }

    // The tool library's TLO writeback listens for [TLO:] in the data stream.
    [Theory]
    [InlineData("GrblHAL 1.1f ['$' or '$HELP' for help]")]
    [InlineData("Grbl 4.0 [FluidNC v4.0.3 (esp32-wifi) '$' for help]")]
    public void TloReport_ReachesDataListeners(string greeting)
    {
        Greet(greeting);
        _controller.HandleIncomingData("[TLO:0.000,0.000,-12.345]");
        lock (_data) Assert.Contains("[TLO:0.000,0.000,-12.345]", _data);
    }

    private static object? GetPrivate(object target, string name) =>
        target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(target);

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
