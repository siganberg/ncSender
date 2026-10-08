using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Tools;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// A tool length measurement stopped half way (G43.1 Z0 done, the new tool
// never measured) left ncSender believing the tool was measured. The Z0 set
// next wasn't kept by the following tool change and the new tool plunged.
// Now an interrupted tool change clears the offset once the machine is Idle.
public class ToolLengthOnAbortTests
{
    private readonly Mock<IToolChangeTracker> _tracker = new();
    private readonly Mock<ICncController> _controller = new();
    private readonly List<string> _sent = [];

    public ToolLengthOnAbortTests()
    {
        _controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .Callback<string, CommandOptions?, CancellationToken>((cmd, _, _) => _sent.Add(cmd))
            .ReturnsAsync(new CommandResult { Status = "success" });
        new ToolLengthOnAbort(_tracker.Object, _controller.Object, NullLogger<ToolLengthOnAbort>.Instance)
            .StartAsync(default).Wait();
    }

    private void End(string outcome, string? reason = null, bool lengthInDoubt = true) =>
        _tracker.Raise(t => t.Ended += null, new ToolChangeEvent(new ToolChangeInfo("M6", 15, 6, "M6 T15", "job", true), outcome, reason, lengthInDoubt));

    private void Status(string status) =>
        _controller.Raise(c => c.StatusReportReceived += null, new MachineState { Status = status });

    [Fact]
    public async Task An_interrupted_tool_change_clears_the_tool_length_once_idle()
    {
        End("aborted", "stopped");
        Status("Alarm");                 // can't take G-code yet
        Assert.Empty(_sent);
        Status("Idle");
        await Task.Delay(50);
        Assert.Equal(["G49"], _sent);
    }

    [Fact]
    public async Task It_is_sent_once()
    {
        End("aborted", "error");
        Status("Idle"); await Task.Delay(50);
        Status("Idle"); await Task.Delay(50);
        Assert.Equal(["G49"], _sent);
    }

    [Fact]
    public async Task A_completed_tool_change_keeps_its_length()
    {
        End("completed");
        Status("Idle"); await Task.Delay(50);
        Assert.Empty(_sent);
    }

    [Fact]
    public async Task A_refused_clear_is_tried_again_at_the_next_idle()
    {
        _controller.SetupSequence(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CommandResult { Status = "error", ErrorMessage = "error:9" })
            .ReturnsAsync(new CommandResult { Status = "success" });
        End("aborted", "alarm");
        Status("Idle"); await Task.Delay(50);
        Status("Idle"); await Task.Delay(50);
        _controller.Verify(c => c.SendCommandAsync("G49", It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
        Status("Idle"); await Task.Delay(50);
        _controller.Verify(c => c.SendCommandAsync("G49", It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    // Aborted with the length intact (the tool sensor found no tool, or the
    // stored length was already applied): the offset is right, so it stays and
    // the next change can use the stored length instead of measuring.
    [Fact]
    public async Task An_abort_that_left_the_length_intact_keeps_it()
    {
        End("aborted", "stopped", lengthInDoubt: false);
        Status("Idle"); await Task.Delay(50);
        Assert.Empty(_sent);
    }
}
