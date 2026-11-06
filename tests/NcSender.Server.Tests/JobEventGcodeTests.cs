using Microsoft.Extensions.Logging;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Job;

namespace NcSender.Server.Tests;

// Program Start / Program End lines go through the command processor like
// job and macro lines: an M6 there runs ncSender's tool change (it used to
// go straight to the controller), and a refused line isn't sent.
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
    public async Task ProgramEnd_M6_RunsTheToolChange()
    {
        var (jobs, sent) = Setup("M5\nM6 T2", cmd => cmd == "M6 T2"
            ? new CommandProcessorResult { Commands = [new() { Command = "(tool change)" }, new() { Command = "G53 G0 Z-5" }] }
            : PassThrough(cmd));

        await jobs.ExecuteEventGcode("programEnd");

        Assert.Equal(new[] { "(Program End Event Begin)", "M5", "(tool change)", "G53 G0 Z-5", "(Program End Event End)" }, sent);
    }

    [Fact]
    public async Task ProgramEnd_StopsAtARefusedLine()
    {
        var (jobs, sent) = Setup("G0 X10\nM9", cmd => cmd == "G0 X10"
            ? new CommandProcessorResult { ShouldContinue = false, SkipReason = "door open" }
            : PassThrough(cmd));

        await jobs.ExecuteEventGcode("programEnd");

        Assert.DoesNotContain("G0 X10", sent);
        Assert.DoesNotContain("M9", sent);
    }
}
