using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

/// <summary>
/// The controller answers every line with one ok/error, in order. A command
/// holding several lines (a plugin's joined sequence) must wait for all of its
/// replies, and replies to lines written outside the queue (coolant bypass)
/// must not complete whatever is queued next.
/// </summary>
public class CncControllerReplyCountTests : IDisposable
{
    private readonly CncController _controller;
    private readonly FakeTransport _transport;

    public CncControllerReplyCountTests()
    {
        _controller = new CncController(
            NullLogger<CncController>.Instance,
            new Mock<ISettingsManager>().Object,
            Array.Empty<IProtocolHandler>(),
            new Mock<IDongleDeviceService>().Object);

        _transport = new FakeTransport();
        SetPrivate(_controller, "_transport", _transport);
        SetPrivate(_controller, "IsConnected", true);
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

    private static async Task<CommandResult> Done(Task<CommandResult> task)
    {
        Assert.Same(task, await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(3))));
        return await task;
    }

    [Fact]
    public async Task MultiLineCommand_CompletesOnItsLastReply()
    {
        var seq = _controller.SendCommandAsync("G4 P0\nM8\nG0 Z0", Job());
        var next = _controller.SendCommandAsync("G0 X1", Job());
        await WaitForWrite("G4 P0\nM8\nG0 Z0\n");

        _controller.HandleIncomingData("ok");
        _controller.HandleIncomingData("ok");
        await Task.Delay(100);
        Assert.False(seq.IsCompleted);
        lock (_transport.WriteLog) Assert.DoesNotContain("G0 X1\n", _transport.WriteLog);

        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(seq)).Status);

        await WaitForWrite("G0 X1\n");
        await Task.Delay(100);
        Assert.False(next.IsCompleted);
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(next)).Status);
    }

    [Fact]
    public async Task MultiLineCommand_ErrorSettlesAndRestAreAbsorbed()
    {
        var seq = _controller.SendCommandAsync("G0 X1\nG0 X2", Job());
        await WaitForWrite("G0 X1\nG0 X2\n");
        _controller.HandleIncomingData("error:20");
        Assert.Equal("error", (await Done(seq)).Status);

        var next = _controller.SendCommandAsync("G0 X3", Job());
        await WaitForWrite("G0 X3\n");
        _controller.HandleIncomingData("ok");   // the sequence's second line
        await Task.Delay(100);
        Assert.False(next.IsCompleted);
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(next)).Status);
    }

    [Fact]
    public async Task CoolantBypassReply_DoesNotCompleteTheNextJobLine()
    {
        var line = _controller.SendCommandAsync("G1 X10 F100", Job());
        await WaitForWrite("G1 X10 F100\n");

        await _controller.SendCommandAsync("M8", Job());   // written straight away
        await WaitForWrite("M8\n");

        _controller.HandleIncomingData("ok");   // G1 X10
        Assert.Equal("success", (await Done(line)).Status);

        var next = _controller.SendCommandAsync("G1 X20", Job());
        await WaitForWrite("G1 X20\n");
        _controller.HandleIncomingData("ok");   // M8
        await Task.Delay(100);
        Assert.False(next.IsCompleted);
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(next)).Status);
    }

    [Fact]
    public async Task CrLfInCommand_IsOneLinePerTerminator()
    {
        var seq = _controller.SendCommandAsync("G0 X1\r\nG0 X2", Job());
        await WaitForWrite("G0 X1\nG0 X2\n");
        _controller.HandleIncomingData("ok");
        _controller.HandleIncomingData("ok");
        Assert.Equal("success", (await Done(seq)).Status);
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
