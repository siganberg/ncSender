using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

// A plugin prompt can carry its own Abort: (GATE_ABORT_OFFERED) before the
// message, then after the M0 a (GATE_ABORT)…(GATE_END) block. Continue skips
// the block; Abort resumes, sends only the block, then the gate soft-resets.
public class GateAbortBlockTests : IDisposable
{
    private readonly CncController _controller;
    private readonly DongleWaitElseTests.AckingTransport _transport;

    public GateAbortBlockTests()
    {
        _controller = new CncController(NullLogger<CncController>.Instance, new Mock<ISettingsManager>().Object,
            Array.Empty<IProtocolHandler>(), new Mock<IDongleDeviceService>().Object);
        _transport = new DongleWaitElseTests.AckingTransport(_controller);
        Set("_transport", _transport);
        Set("IsConnected", true);
        Invoke("StartQueueConsumer");
    }

    public void Dispose() => Invoke("StopQueueConsumer");

    private List<string> Sent()
    {
        lock (_transport.Written) return _transport.Written.Select(w => w.TrimEnd('\n').ToUpperInvariant()).ToList();
    }

    private async Task Send(params string[] lines)
    {
        foreach (var line in lines) await _controller.SendCommandAsync(line);
    }

    private static readonly string[] Prompt = ["G53 G0 Z-5", "(GATE_ABORT_OFFERED)", "(MSG, PLUGIN_PNEUMATICATC:TOOL_FAILED_TO_SEAT)", "M0"];
    private static readonly string[] Block = ["(GATE_ABORT)", "G53 G0 X-55 Y40", "G53 G0 X300 Y200", "G4 P0"];

    [Fact]
    public async Task Continue_skips_the_abort_block()
    {
        await Send([.. Prompt, .. Block, "(GATE_END)", "M61 Q1"]);
        Assert.Equal(["G53 G0 Z-5", "(MSG, PLUGIN_PNEUMATICATC:TOOL_FAILED_TO_SEAT)", "M0", "M61 Q1"], Sent());
    }

    [Fact]
    public async Task Abort_runs_only_the_block_then_holds_until_the_reset()
    {
        await Send(Prompt);
        Assert.True(_controller.TryArmGateAbort(out var blockDone));
        var queued = Task.Run(() => Send([.. Block, "(GATE_END)", "M61 Q1", "G43.1 Z-40"]));

        await blockDone.WaitAsync(TimeSpan.FromSeconds(5));
        await Task.Delay(100);
        Assert.Equal(["G53 G0 Z-5", "(MSG, PLUGIN_PNEUMATICATC:TOOL_FAILED_TO_SEAT)", "M0",
            "G53 G0 X-55 Y40", "G53 G0 X300 Y200", "G4 P0"], Sent());

        _controller.FlushQueue("soft reset");          // the gate's reset
        await Task.WhenAny(queued, Task.Delay(2000));
        Assert.DoesNotContain("M61 Q1", Sent());
        Assert.DoesNotContain("G43.1 Z-40", Sent());
    }

    [Fact]
    public async Task A_prompt_without_an_offer_cannot_be_armed()
    {
        await Send("(MSG, PLUGIN_PNEUMATICATC:LOW_AIR)", "M0");
        Assert.False(_controller.TryArmGateAbort(out _));
    }

    [Fact]
    public async Task The_offer_ends_with_its_block()
    {
        await Send([.. Prompt, .. Block, "(GATE_END)"]);
        Assert.False(_controller.TryArmGateAbort(out _));
    }

    [Fact]
    public async Task A_reset_clears_an_armed_abort_and_releases_its_waiter()
    {
        await Send(Prompt);
        Assert.True(_controller.TryArmGateAbort(out var blockDone));
        _controller.FlushQueue("stop");
        await blockDone.WaitAsync(TimeSpan.FromSeconds(1));
        await Send([.. Block, "(GATE_END)", "G0 X1"]);
        Assert.Equal("G0 X1", Sent()[^1]);
        Assert.DoesNotContain("G53 G0 X300 Y200", Sent());
    }

    private void Set(string name, object value)
    {
        var t = typeof(CncController);
        var f = t.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);
        if (f is not null) { f.SetValue(_controller, value); return; }
        t.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!.SetValue(_controller, value);
    }

    private void Invoke(string name) =>
        typeof(CncController).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_controller, null);
}
