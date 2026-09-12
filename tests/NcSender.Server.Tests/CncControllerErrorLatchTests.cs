using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

/// <summary>
/// grblHAL keeps re-reporting the last error for every G-code line until it
/// sees an empty line, a '$' command, or a soft reset. These tests lock in the
/// controller's fix: every interactive command is preceded by a bare newline
/// so it is always parsed fresh, while job lines and '$' commands are not.
/// </summary>
public class CncControllerErrorLatchTests : IDisposable
{
    private readonly CncController _controller;
    private readonly FakeTransport _transport;

    public CncControllerErrorLatchTests()
    {
        var settings = new Mock<ISettingsManager>();
        var dongle = new Mock<IDongleDeviceService>();
        _controller = new CncController(
            NullLogger<CncController>.Instance,
            settings.Object,
            Array.Empty<IProtocolHandler>(),
            dongle.Object);

        _transport = new FakeTransport();
        SetPrivate(_controller, "_transport", _transport);
        SetPrivate(_controller, "IsConnected", true);
        InvokePrivate(_controller, "StartQueueConsumer");
    }

    public void Dispose() => InvokePrivate(_controller, "StopQueueConsumer");

    private static CommandOptions From(string source) =>
        new() { Meta = new CommandMeta { SourceId = source } };

    /// <summary>Send a command and answer it with the given reply once it hits the transport.</summary>
    private async Task<CommandResult> SendAndReply(string command, string source, string reply)
    {
        var task = _controller.SendCommandAsync(command, From(source));
        if (source != "job" && command[0] != '$')
        {
            // The clear line goes out first and takes its own "ok".
            await WaitForNextWrite("\n");
            _controller.HandleIncomingData("ok");
        }
        await WaitForNextWrite(command.ToUpperInvariant() + "\n");
        _controller.HandleIncomingData(reply);
        var done = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(3)));
        Assert.Same(task, done);
        return await task;
    }

    private int _consumed;

    /// <summary>Wait until the next unconsumed transport write equals <paramref name="expected"/>.</summary>
    private async Task WaitForNextWrite(string expected)
    {
        for (var i = 0; i < 80; i++)
        {
            lock (_transport.WriteLog)
            {
                if (_transport.WriteLog.Count > _consumed)
                {
                    var actual = _transport.WriteLog[_consumed++];
                    Assert.Equal(expected, actual);
                    return;
                }
            }
            await Task.Delay(25);
        }
        Assert.Fail($"transport never received {expected.Replace("\n", "\\n")}; got: {string.Join(" | ", _transport.WriteLog)}");
    }

    private List<string> Writes()
    {
        lock (_transport.WriteLog) return _transport.WriteLog.ToList();
    }

    [Fact]
    public async Task ClientCommand_IsAlwaysPrecededByEmptyLine()
    {
        var first = await SendAndReply("M3 S1000", "client", "error:1");
        Assert.Equal("error", first.Status);

        var result = await SendAndReply("G0 X1", "client", "ok");
        Assert.Equal("success", result.Status);
        Assert.Equal(new[] { "\n", "M3 S1000\n", "\n", "G0 X1\n" }, Writes());
    }

    [Fact]
    public async Task MacroCommand_IsPrecededByEmptyLine()
    {
        var result = await SendAndReply("G0 X1", "macro", "ok");
        Assert.Equal("success", result.Status);
        Assert.Equal(new[] { "\n", "G0 X1\n" }, Writes());
    }

    [Fact]
    public async Task JobLineAfterError_IsNotPrecededByEmptyLine()
    {
        await SendAndReply("G1 X1 F100", "job", "error:1");

        var next = _controller.SendCommandAsync("G1 X2", From("job"));
        await WaitForNextWrite("G1 X2\n");
        _controller.HandleIncomingData("error:1");
        var result = await next;

        Assert.Equal("error", result.Status);
        Assert.Equal(new[] { "G1 X1 F100\n", "G1 X2\n" }, Writes());
    }

    [Fact]
    public async Task DollarCommand_IsNotPrecededByEmptyLine()
    {
        await SendAndReply("M3 S1000", "client", "error:1");
        var unlock = await SendAndReply("$X", "client", "ok");
        var jog = await SendAndReply("$J=G91 X1 F500", "client", "ok");

        Assert.Equal("success", unlock.Status);
        Assert.Equal("success", jog.Status);
        Assert.Equal(new[] { "\n", "M3 S1000\n", "$X\n", "$J=G91 X1 F500\n" }, Writes());
    }

    [Fact]
    public async Task BurstOfClientLines_EachGetsItsOwnClear()
    {
        var a = _controller.SendCommandAsync("G0 X1", From("client"));
        var b = _controller.SendCommandAsync("G0 X2", From("client"));
        await WaitForNextWrite("\n");
        _controller.HandleIncomingData("ok");
        await WaitForNextWrite("G0 X1\n");
        _controller.HandleIncomingData("ok");
        await WaitForNextWrite("\n");
        _controller.HandleIncomingData("ok");
        await WaitForNextWrite("G0 X2\n");
        _controller.HandleIncomingData("ok");
        await Task.WhenAll(a, b);

        Assert.Equal(new[] { "\n", "G0 X1\n", "\n", "G0 X2\n" }, Writes());
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
