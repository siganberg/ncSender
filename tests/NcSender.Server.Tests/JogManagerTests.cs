using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Jogging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

public class JogManagerTests
{
    private readonly Mock<ICncController> _controller;
    private readonly Mock<ICommandProcessor> _commandProcessor;
    private readonly Mock<IBroadcaster> _broadcaster;
    private readonly JogManager _svc;

    public JogManagerTests()
    {
        _controller = new Mock<ICncController>();
        _controller.SetupGet(c => c.IsConnected).Returns(true);
        _controller.SetupGet(c => c.LastStatus).Returns(new MachineState());
        _controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>()))
            .ReturnsAsync(new CommandResult { Status = "success" });

        _commandProcessor = new Mock<ICommandProcessor>();
        _commandProcessor.Setup(p => p.ProcessAsync(It.IsAny<string>(), It.IsAny<CommandProcessorContext>()))
            .ReturnsAsync((string cmd, CommandProcessorContext _) => new CommandProcessorResult
            {
                ShouldContinue = true,
                Commands = [new ProcessedCommand { Command = cmd, IsOriginal = true }]
            });

        _broadcaster = new Mock<IBroadcaster>();
        _broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);
        _broadcaster.Setup(b => b.SendToClient(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        _svc = new JogManager(
            _controller.Object,
            _commandProcessor.Object,
            _broadcaster.Object,
            NullLogger<JogManager>.Instance);
    }

    private static JsonElement CreateJsonElement(object obj)
    {
        var json = JsonSerializer.Serialize(obj);
        return JsonDocument.Parse(json).RootElement;
    }

    [Fact]
    public async Task JogStart_SendsCommandToController()
    {
        var data = CreateJsonElement(new { jogId = "jog-1", command = "$J=G91 X10 F1000" });

        await _svc.HandleMessageAsync("client-1", "jog:start", data);

        _controller.Verify(c => c.SendCommandAsync("$J=G91 X10 F1000", It.IsAny<CommandOptions>()), Times.Once);
    }

    [Fact]
    public async Task JogStart_RepliesWithStarted()
    {
        var data = CreateJsonElement(new { jogId = "jog-1", command = "$J=G91 X10 F1000" });

        await _svc.HandleMessageAsync("client-1", "jog:start", data);

        _broadcaster.Verify(b => b.SendToClient("client-1", "jog:started", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public async Task JogStop_SendsJogCancel()
    {
        var startData = CreateJsonElement(new { jogId = "jog-1", command = "$J=G91 X10 F1000" });
        await _svc.HandleMessageAsync("client-1", "jog:start", startData);

        var stopData = CreateJsonElement(new { jogId = "jog-1" });
        await _svc.HandleMessageAsync("client-1", "jog:stop", stopData);

        _controller.Verify(c => c.SendCommandAsync("\x85", It.IsAny<CommandOptions>()), Times.Once);
    }

    [Fact]
    public async Task JogStop_RepliesWithStopped()
    {
        var startData = CreateJsonElement(new { jogId = "jog-1", command = "$J=G91 X10 F1000" });
        await _svc.HandleMessageAsync("client-1", "jog:start", startData);

        var stopData = CreateJsonElement(new { jogId = "jog-1" });
        await _svc.HandleMessageAsync("client-1", "jog:stop", stopData);

        _broadcaster.Verify(b => b.SendToClient("client-1", "jog:stopped", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public async Task JogStep_SendsSingleCommand()
    {
        var data = CreateJsonElement(new { command = "$J=G91 X1 F500" });

        await _svc.HandleMessageAsync("client-1", "jog:step", data);

        _controller.Verify(c => c.SendCommandAsync("$J=G91 X1 F500", It.IsAny<CommandOptions>()), Times.Once);
    }

    [Fact]
    public async Task HandleDisconnect_CleansUpSessions()
    {
        var data = CreateJsonElement(new { jogId = "jog-1", command = "$J=G91 X10 F1000" });
        await _svc.HandleMessageAsync("client-1", "jog:start", data);

        await _svc.HandleDisconnectAsync("client-1");

        // Should send jog cancel on disconnect
        _controller.Verify(c => c.SendCommandAsync("\x85", It.IsAny<CommandOptions>()), Times.Once);
    }

    [Fact]
    public async Task WatchdogTimeout_SendsJogCancel()
    {
        var data = CreateJsonElement(new { jogId = "jog-timeout", command = "$J=G91 X10 F1000" });
        await _svc.HandleMessageAsync("client-1", "jog:start", data);

        // Wait for watchdog timeout (2000ms + buffer)
        await Task.Delay(2500);

        // Should have sent jog cancel due to timeout
        _controller.Verify(c => c.SendCommandAsync("\x85", It.IsAny<CommandOptions>()), Times.AtLeastOnce);
    }
}
