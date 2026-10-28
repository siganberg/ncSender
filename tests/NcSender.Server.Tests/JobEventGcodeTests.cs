using Microsoft.Extensions.Logging;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Job;

namespace NcSender.Server.Tests;

// Program Start / Program End lines go through the command processor, so
// $PARK, $TLS and M6 work there and a refused line isn't sent.
public class JobEventGcodeTests
{
    private static (JobManager Jobs, List<string> Sent) Setup(string programEnd, Func<string, CommandProcessorResult> process)
    {
        var sent = new List<string>();
        var controller = new Mock<ICncController>();
        controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .Callback<string, CommandOptions?, CancellationToken>((cmd, _, _) => sent.Add(cmd))
            .ReturnsAsync((string cmd, CommandOptions? _, CancellationToken _) => new CommandResult { Command = cmd });

        var processor = new Mock<ICommandProcessor>();
        processor.Setup(p => p.ProcessAsync(It.IsAny<string>(), It.IsAny<CommandProcessorContext>()))
            .ReturnsAsync((string cmd, CommandProcessorContext _) => process(cmd));

        var context = new Mock<IServerContext>();
        context.SetupGet(c => c.State).Returns(new ServerState());

        var settings = new Mock<ISettingsManager>();
        settings.Setup(s => s.GetSetting<bool?>("events.programEndEnabled", It.IsAny<bool?>())).Returns(true);
        settings.Setup(s => s.GetSetting<string>("events.programEnd", It.IsAny<string?>())).Returns(programEnd);

        var jobs = new JobManager(controller.Object, processor.Object, context.Object,
            Mock.Of<IBroadcaster>(), Mock.Of<IJsPluginEngine>(), settings.Object,
            Mock.Of<ILogger<JobManager>>());
        return (jobs, sent);
    }

    private static CommandProcessorResult PassThrough(string cmd) =>
        new() { Commands = [new ProcessedCommand { Command = cmd, IsOriginal = true }] };

    [Fact]
    public async Task ProgramEnd_ExpandsParkThroughTheProcessor()
    {
        var (jobs, sent) = Setup("M5\n$PARK", cmd => cmd == "$PARK"
            ? new CommandProcessorResult { Commands = [new() { Command = "G53 G21 G0 Z-5.000" }, new() { Command = "G53 G21 G0 X2.000 Y2.000" }] }
            : PassThrough(cmd));

        await jobs.ExecuteEventGcode("programEnd");

        Assert.Equal(new[] { "(Program End Event Begin)", "M5", "G53 G21 G0 Z-5.000", "G53 G21 G0 X2.000 Y2.000", "(Program End Event End)" }, sent);
    }

    [Fact]
    public async Task ProgramEnd_StopsAtARefusedLine()
    {
        var (jobs, sent) = Setup("$PARK\nM9", cmd => cmd == "$PARK"
            ? new CommandProcessorResult { ShouldContinue = false, SkipReason = "home the machine first" }
            : PassThrough(cmd));

        await jobs.ExecuteEventGcode("programEnd");

        Assert.DoesNotContain("$PARK", sent);
        Assert.DoesNotContain("M9", sent);
    }
}
