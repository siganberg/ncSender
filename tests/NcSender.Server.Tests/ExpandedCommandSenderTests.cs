using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.CommandProcessor;
using Xunit;

namespace NcSender.Server.Tests;

public class ExpandedCommandSenderTests
{
    private static (Mock<ICncController> cnc, List<string> sent) Controller(params string[] failing)
    {
        var sent = new List<string>();
        var cnc = new Mock<ICncController>();
        cnc.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
           .ReturnsAsync((string c, CommandOptions? _, CancellationToken _) =>
           {
               sent.Add(c);
               return new CommandResult
               {
                   Command = c,
                   Status = failing.Contains(c) ? "error" : "success",
                   ErrorMessage = failing.Contains(c) ? "error:71" : null
               };
           });
        return (cnc, sent);
    }

    private static Task<CommandResult?> Send(Mock<ICncController> cnc, params ProcessedCommand[] cmds)
        => ExpandedCommandSender.SendAsync(cnc.Object, new Mock<IBroadcaster>().Object,
            NullLogger.Instance, cmds, _ => new CommandOptions());

    [Fact]
    public async Task Stops_at_the_first_error_but_still_unwinds()
    {
        var (cnc, sent) = Controller("M960 PO");
        await Send(cnc,
            new ProcessedCommand { Command = "(MSG, TOOL_CHANGE_START)" },
            new ProcessedCommand { Command = "M960 PO" },
            new ProcessedCommand { Command = "G53 G0 Z-5" },
            new ProcessedCommand { Command = "M61 Q2" },
            new ProcessedCommand { Command = "(MSG, TOOL_CHANGE_COMPLETE)", Cleanup = true });

        Assert.Equal(new[] { "(MSG, TOOL_CHANGE_START)", "M960 PO", "(MSG, TOOL_CHANGE_COMPLETE)" }, sent);
    }

    [Fact]
    public async Task Sends_everything_when_nothing_fails()
    {
        var (cnc, sent) = Controller();
        await Send(cnc,
            new ProcessedCommand { Command = "G0 X1" },
            new ProcessedCommand { Command = "G0 X2" },
            new ProcessedCommand { Command = "(MSG, TOOL_CHANGE_COMPLETE)", Cleanup = true });
        Assert.Equal(3, sent.Count);
    }

    [Fact]
    public async Task A_single_command_error_is_just_returned()
    {
        var (cnc, sent) = Controller("G0 X");
        var result = await Send(cnc, new ProcessedCommand { Command = "G0 X" });
        Assert.Single(sent);
        Assert.Equal("error", result!.Status);
    }
}
