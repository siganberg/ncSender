using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using NcSender.Server.Protocols.GrblHal;

namespace NcSender.Server.Tests;

/// <summary>
/// When the controller resets on its own (leaving check mode, a reset button)
/// it drops every line it hadn't answered. Its greeting settles those lines so
/// the send-and-wait queue moves on instead of waiting for replies that never come.
/// </summary>
public class CncControllerResetReplyTests : IDisposable
{
    private const string Greeting = "GrblHAL 1.1f ['$' or '$HELP' for help]";
    private readonly CncController _controller;
    private readonly FakeTransport _transport = new();

    public CncControllerResetReplyTests()
    {
        _controller = new CncController(
            NullLogger<CncController>.Instance,
            new Mock<ISettingsManager>().Object,
            [new GrblHalProtocol()],
            new Mock<IDongleDeviceService>().Object);
        SetPrivate(_controller, "_transport", _transport);
        SetPrivate(_controller, "IsConnected", true);
        SetPrivate(_controller, "_activeProtocol", new GrblHalProtocol());
        SetPrivate(_controller, "_hasReceivedGreeting", true);
        InvokePrivate(_controller, "StartQueueConsumer");
    }

    public void Dispose() => InvokePrivate(_controller, "StopQueueConsumer");

    private static CommandOptions Job() => new() { Meta = new CommandMeta { SourceId = "job" } };

    private async Task WaitForWrite(string expected)
    {
        for (var i = 0; i < 80; i++)
        {
            lock (_transport.WriteLog) if (_transport.WriteLog.Contains(expected)) return;
            await Task.Delay(25);
        }
        Assert.Fail($"transport never received {expected.Replace("\n", "\\n")}; got: {string.Join(" | ", _transport.WriteLog)}");
    }

    private static async Task Settled(Task task) =>
        Assert.Same(task, await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(3))));

    [Fact]
    public async Task LeavingCheckMode_SettlesItsLine_AndTheNextLineGoesOut()
    {
        var exit = _controller.SendCommandAsync("$C", Job());
        var next = _controller.SendCommandAsync("G0 X1", Job());
        await WaitForWrite("$C\n");

        _controller.HandleIncomingData("[MSG:Disabled]");
        _controller.HandleIncomingData(Greeting);

        await Settled(exit);
        Assert.True(exit.IsCanceled);
        await WaitForWrite("G0 X1\n");
        _controller.HandleIncomingData("ok");
        await Settled(next);
        Assert.Equal("success", (await next).Status);
    }

    [Fact]
    public async Task LineWrittenDuringASoftReset_IsSettledByTheGreeting()
    {
        await _controller.SendCommandAsync("\x18", Job());
        var lost = _controller.SendCommandAsync("$G", Job());
        await WaitForWrite("$G\n");

        _controller.HandleIncomingData(Greeting);

        await Settled(lost);
        Assert.True(lost.IsCanceled);
        var after = _controller.SendCommandAsync("$G", Job());
        await Task.Delay(50);
        _controller.HandleIncomingData("ok");
        await Settled(after);
        Assert.Equal("success", (await after).Status);
    }

    [Fact]
    public async Task WithoutAReset_AnUnansweredLineKeepsWaiting()
    {
        var line = _controller.SendCommandAsync("G4 P1", Job());
        await WaitForWrite("G4 P1\n");
        _controller.HandleIncomingData("[MSG:Something]");
        await Task.Delay(150);
        Assert.False(line.IsCompleted);
        _controller.HandleIncomingData("ok");
        await Settled(line);
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

    private static void InvokePrivate(object target, string name) =>
        target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(target, null);

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
