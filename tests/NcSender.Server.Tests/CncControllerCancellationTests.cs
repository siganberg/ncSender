using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

/// <summary>
/// Regression suite for the "spinner-until-soft-reset" hang: any command that
/// never received an "ok" from the controller used to wedge the send pipeline
/// forever, because <see cref="ICncController.SendCommandAsync"/> ignored
/// cancellation tokens. These tests lock the fixed behavior in — a hanging
/// command must be cancellable by the caller AND the queue must recover so
/// the next command still goes through.
/// </summary>
public class CncControllerCancellationTests : IDisposable
{
    private readonly CncController _controller;
    private readonly FakeTransport _transport;

    public CncControllerCancellationTests()
    {
        var settings = new Mock<ISettingsManager>();
        var dongle = new Mock<IDongleDeviceService>();
        _controller = new CncController(
            NullLogger<CncController>.Instance,
            settings.Object,
            Array.Empty<IProtocolHandler>(),
            dongle.Object);

        _transport = new FakeTransport();

        // Bypass ConnectAsync (which insists on a real serial/tcp target) —
        // inject transport + connected flag + queue consumer via reflection.
        // These are private for real callers but need to be primed for the
        // unit test to exercise SendCommandAsync in isolation.
        SetPrivate(_controller, "_transport", _transport);
        SetPrivate(_controller, "IsConnected", true);
        InvokePrivate(_controller, "StartQueueConsumer");
    }

    public void Dispose()
    {
        InvokePrivate(_controller, "StopQueueConsumer");
    }

    [Fact]
    public async Task SendCommandAsync_WhenControllerNeverAcks_CallerCancellationUnblocks()
    {
        // Arrange — controller never emits "ok" (transport captures write but
        // stays silent). Caller uses a 250ms cancellation.
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
        var start = DateTime.UtcNow;

        // Act + Assert — caller unblocks with cancellation, not a hang.
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await _controller.SendCommandAsync("$I", null, cts.Token));

        var elapsed = DateTime.UtcNow - start;
        Assert.True(elapsed < TimeSpan.FromSeconds(2),
            $"Caller should have unblocked within ~250ms, took {elapsed.TotalMilliseconds:0}ms");
        Assert.Contains("$I\n", _transport.WriteLog);
    }

    [Fact]
    public async Task SendCommandAsync_AfterCancelledCommand_QueueRecoversForNextCommand()
    {
        // Arrange — first command times out. Second command should still be
        // processed by the queue (previous bug: queue consumer wedged on the
        // first WaitAsync forever, no subsequent command could go through).
        using var cts1 = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await _controller.SendCommandAsync("$I", null, cts1.Token));

        // Act — send a second command. Emit "ok" for it via HandleIncomingData
        // after a short delay so the queue consumer completes it normally.
        var secondTask = _controller.SendCommandAsync("$$", null);
        _ = Task.Run(async () =>
        {
            // Wait for the write to hit the fake transport, then reply "ok".
            for (var i = 0; i < 20 && !_transport.WriteLog.Contains("$$\n"); i++)
                await Task.Delay(25);
            _controller.HandleIncomingData("ok");
        });

        // Assert — second command completes successfully within a reasonable
        // window. If the queue was wedged, this would hang until test timeout.
        var completed = await Task.WhenAny(secondTask, Task.Delay(TimeSpan.FromSeconds(3)));
        Assert.Same(secondTask, completed);
        var result = await secondTask;
        Assert.Equal("success", result.Status);
    }

    [Fact]
    public async Task SendCommandAsync_QueuedCommand_CancelBeforeOkDoesNotBlockNextCaller()
    {
        // Arrange — first caller queues a command but the fake transport
        // never replies. Caller cancels almost immediately. A second caller
        // right behind must not inherit the wedge.
        using var cts1 = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        var first = _controller.SendCommandAsync("$G", null, cts1.Token);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await first);

        // Act — second caller, reply to it after a moment.
        var secondTask = _controller.SendCommandAsync("$#", null);
        _ = Task.Run(async () =>
        {
            for (var i = 0; i < 40 && !_transport.WriteLog.Contains("$#\n"); i++)
                await Task.Delay(25);
            _controller.HandleIncomingData("ok");
        });

        var completed = await Task.WhenAny(secondTask, Task.Delay(TimeSpan.FromSeconds(3)));
        Assert.Same(secondTask, completed);
        var result = await secondTask;
        Assert.Equal("success", result.Status);
    }

    // --- helpers ---------------------------------------------------------

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

        public Task ConnectAsync(CancellationToken ct = default)
        {
            IsConnected = true;
            return Task.CompletedTask;
        }
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

        // Keep the events "used" so the compiler doesn't warn about unused
        // members — they're part of the interface even if this fake never
        // fires them.
        public void RaiseLineReceived(string line) => LineReceived?.Invoke(line);
        public void RaiseConnectionLost(Exception? ex) => ConnectionLost?.Invoke(ex);
    }
}
