using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

// A sensor on the Wireless I/O can't use M66, so the plugin follows a
// DONGLE_WAIT:…:else with its own failure block, (DONGLE_ELSE)…(DONGLE_END):
// skipped when the input arrived, sent when it didn't, the way an o-word `if`
// on #5399 works for a wired sensor.
public class DongleWaitElseTests : IDisposable
{
    private readonly CncController _controller;
    private readonly AckingTransport _transport;
    private readonly Mock<IDongleDeviceService> _dongle = new();

    public DongleWaitElseTests()
    {
        _controller = new CncController(NullLogger<CncController>.Instance, new Mock<ISettingsManager>().Object,
            Array.Empty<IProtocolHandler>(), _dongle.Object);
        _dongle.Setup(d => d.GetDevice(It.IsAny<string>())).Returns((DongleDeviceInfo?)null);
        _transport = new AckingTransport(_controller);
        Set("_transport", _transport);
        Set("IsConnected", true);
        Invoke("StartQueueConsumer");
    }

    public void Dispose() => Invoke("StopQueueConsumer");

    private void InputResult(DongleWaitResult result) =>
        _dongle.Setup(d => d.WaitForValueAsync("xio", "in0", 1, 0, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(result);

    private async Task<List<string>> Run(params string[] lines)
    {
        foreach (var line in lines) await _controller.SendCommandAsync(line);
        // Lines reach the controller upper-cased; compare that way.
        lock (_transport.Written) return _transport.Written.Select(w => w.TrimEnd('\n').ToUpperInvariant()).ToList();
    }

    private static readonly string[] Guard =
    [
        "G4 P0",
        "(DONGLE_WAIT:xio:in0=1:0:3:else)",
        "(DONGLE_ELSE)",
        "G53 G0 Z-5",
        "(MSG, PLUGIN_PNEUMATICATC:DRAWBAR_FAILED_TO_OPEN)",
        "M0",
        "(DONGLE_END)",
        "G53 G0 X10",
    ];

    [Fact]
    public async Task Input_arrived_skips_the_failure_block()
    {
        InputResult(DongleWaitResult.Arrived);
        var sent = await Run(Guard);
        Assert.Equal(["G4 P0", "(DONGLE_WAIT:XIO:IN0=1:0:3:ELSE)", "G53 G0 X10"], sent);
    }

    [Fact]
    public async Task Input_never_arrived_runs_the_block_without_the_generic_pause_or_a_resend()
    {
        InputResult(DongleWaitResult.TimedOut);
        var sent = await Run(Guard);
        Assert.Equal(["G4 P0", "(DONGLE_WAIT:XIO:IN0=1:0:3:ELSE)", "G53 G0 Z-5",
            "(MSG, PLUGIN_PNEUMATICATC:DRAWBAR_FAILED_TO_OPEN)", "M0", "G53 G0 X10"], sent);
        Assert.DoesNotContain(sent, s => s.Contains("NCSENDER_PAUSE"));
        _dongle.Verify(d => d.SendAsync(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task An_accessory_send_inside_a_skipped_block_never_fires()
    {
        InputResult(DongleWaitResult.AlreadyThere);
        await Run("(DONGLE_WAIT:xio:in0=1:0:3:else)", "(DONGLE_ELSE)", "(DONGLE:xio:out 0 1)", "(DONGLE_END)");
        _dongle.Verify(d => d.SendAsync("xio", "out 0 1"), Times.Never);
    }

    [Fact]
    public async Task A_block_without_a_failed_else_wait_before_it_is_skipped()
    {
        var sent = await Run("(DONGLE_ELSE)", "M0", "(DONGLE_END)", "G0 X1");
        Assert.Equal(["G0 X1"], sent);
    }

    [Fact]
    public async Task A_reset_clears_a_half_finished_block()
    {
        InputResult(DongleWaitResult.Arrived);
        await Run("(DONGLE_WAIT:xio:in0=1:0:3:else)", "(DONGLE_ELSE)");   // now skipping
        _controller.FlushQueue("soft reset");
        var sent = await Run("G0 X2");
        Assert.Contains("G0 X2", sent);
    }

    [Fact]
    public async Task A_plain_wait_still_pauses_when_the_accessory_never_answers()
    {
        _dongle.Setup(d => d.WaitForValueAsync("autodustboot", "pos", 0, 50, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(DongleWaitResult.TimedOut);
        var sent = await Run("(DONGLE_WAIT:autodustboot:pos=0:50:1)");
        Assert.StartsWith("(MSG, NCSENDER_PAUSE: DUST BOOT NOT RESPONDING", sent.Single());
    }

    [Theory]
    [InlineData("(DONGLE_WAIT:xio:in0=1:0:3:else)", true)]
    [InlineData("(DONGLE_WAIT:XIO:IN0=1:0:3:ELSE)", true)]
    [InlineData("(DONGLE_WAIT:xio:in0=1:0:3)", false)]
    public void Parses_the_else_flag(string line, bool hasElse) =>
        Assert.Equal(hasElse, DongleWait.TryParse(line)!.Else);

    [Fact]
    public void Rejects_an_unknown_fifth_field() =>
        Assert.Null(DongleWait.TryParse("(DONGLE_WAIT:xio:in0=1:0:3:maybe)"));

    private void Set(string name, object value)
    {
        var t = typeof(CncController);
        var f = t.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);
        if (f is not null) { f.SetValue(_controller, value); return; }
        t.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!.SetValue(_controller, value);
    }

    private void Invoke(string name) =>
        typeof(CncController).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_controller, null);

    // Records every line and answers "ok" to it, like a controller would.
    private sealed class AckingTransport(CncController controller) : IConnectionTransport
    {
        public readonly List<string> Written = new();
        public bool IsConnected => true;
        public string TransportType => "fake";
        public string PortPath => "fake://test";
        public Task ConnectAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task DisconnectAsync() => Task.CompletedTask;
        public Task WriteAsync(string data, CancellationToken ct = default)
        {
            lock (Written) Written.Add(data);
            _ = Task.Run(async () => { await Task.Delay(5); controller.HandleIncomingData("ok"); });
            return Task.CompletedTask;
        }
        public Task WriteRawAsync(byte[] data, CancellationToken ct = default) => Task.CompletedTask;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
#pragma warning disable CS0067
        public event Action<string>? LineReceived;
        public event Action<Exception?>? ConnectionLost;
#pragma warning restore CS0067
    }
}
