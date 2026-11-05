using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Job;
using Moq;

namespace NcSender.Server.Tests;

// Stop used to wait a fixed 500 ms between Feed Hold and Soft Reset. Machines
// with aggressive feeds were still decelerating, the reset alarmed ("reset
// while in motion") and the machine had to be rehomed. The reset now waits
// for the controller to report the hold complete.
public class StopSequenceTests
{
    [Theory]
    [InlineData("<Hold:0|MPos:0,0,0|FS:0,0>", true)]
    [InlineData("<Hold:1|MPos:0,0,0|FS:1200,0>", false)]
    [InlineData("<Hold|MPos:0,0,0>", false)]
    [InlineData("<Run|MPos:0,0,0>", false)]
    [InlineData("<Jog|MPos:0,0,0>", false)]
    [InlineData("<Home|MPos:0,0,0>", false)]
    [InlineData("<Idle|MPos:0,0,0>", true)]
    [InlineData("<Alarm:3|MPos:0,0,0>", true)]
    [InlineData("<Door:0|MPos:0,0,0>", true)]
    [InlineData("<Door:1|MPos:0,0,0>", true)]
    [InlineData("<Door:2|MPos:0,0,0>", false)]
    [InlineData("<Door:3|MPos:0,0,0>", false)]
    [InlineData("<hold:0>", true)]
    [InlineData("", null)]
    [InlineData(null, null)]
    [InlineData("<Weird|MPos:0,0,0>", null)]
    public void Reads_whether_the_axes_are_at_rest(string? raw, bool? expected)
    {
        Assert.Equal(expected, StopSequence.IsMotionStopped(raw));
    }

    [Fact]
    public async Task Soft_reset_waits_until_the_hold_completes()
    {
        var raw = "<Run|MPos:0,0,0>";
        var controller = new Mock<ICncController>();
        controller.SetupGet(c => c.RawStatusData).Returns(() => raw);
        var sent = new List<(string Cmd, string Status)>();
        controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .Callback<string, CommandOptions?, CancellationToken>((cmd, _, _) => sent.Add((cmd, raw)))
            .ReturnsAsync(new CommandResult { Status = "success" });

        var stop = StopSequence.FeedHoldThenResetAsync(controller.Object, 500, "test");

        foreach (var report in new[] { "<Hold:1|FS:3000,0>", "<Hold:1|FS:1500,0>", "<Hold:1|FS:200,0>" })
        {
            await Task.Delay(400);
            raw = new string(report);
            Assert.DoesNotContain(sent, s => s.Cmd == "\x18");
        }

        await Task.Delay(100);
        raw = new string("<Hold:0|FS:0,0>");
        await stop.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal(["!", "\x18"], sent.Select(s => s.Cmd));
        Assert.StartsWith("<Hold:0", sent[1].Status);
    }

    [Fact]
    public async Task A_stale_report_from_before_the_hold_is_not_trusted()
    {
        var raw = "<Idle|MPos:0,0,0>";
        var controller = new Mock<ICncController>();
        controller.SetupGet(c => c.RawStatusData).Returns(() => raw);

        var wait = StopSequence.WaitForMotionStopAsync(controller.Object, 5000);
        await Task.Delay(100);
        Assert.False(wait.IsCompleted);

        raw = new string("<Hold:1>");
        await Task.Delay(60);
        raw = new string("<Hold:0>");
        Assert.Equal(StopWaitResult.Stopped, await wait.WaitAsync(TimeSpan.FromSeconds(2)));
    }

    [Fact]
    public async Task Without_status_reports_it_falls_back_to_the_delay()
    {
        var controller = new Mock<ICncController>();
        controller.SetupGet(c => c.RawStatusData).Returns("<Run>");

        var started = DateTime.UtcNow;
        var result = await StopSequence.WaitForMotionStopAsync(controller.Object, 1200);

        Assert.Equal(StopWaitResult.NoStatus, result);
        Assert.InRange((DateTime.UtcNow - started).TotalMilliseconds, 1150, 3000);
    }
}
