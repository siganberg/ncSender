using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Probing;
using NcSender.Server.Probing.Strategies;

namespace NcSender.Server.Tests;

/// <summary>
/// Center probing reports the size it measured: the distance between the
/// slow probe's touches on opposite walls, plus the tip for a hole and minus
/// it for a part.
/// </summary>
public class CenterProbeMeasurementTests
{
    // A 50 x 30 hole (or part) centred on X100 Y200, probed with a 2 mm tip.
    // The fast search touches 0.4 mm off the slow probe; only the slow one counts.
    private static (double fast, double slow) Touch(string cmd, bool inner)
    {
        var neg = cmd.Contains("X-") || cmd.Contains("Y-");
        var isX = cmd.Contains('X');
        var half = (isX ? 50 : 30) / 2.0;
        var centre = isX ? 100 : 200;
        // Inner: moving -X finds the left wall (tip centre a radius inside it).
        // Outer: moving +X finds the left face (tip centre a radius outside it).
        double wall = inner
            ? (neg ? centre - half + 1 : centre + half - 1)
            : (neg ? centre + half + 1 : centre - half - 1);
        return (wall + (neg ? 0.4 : -0.4), wall);
    }

    private static async Task<(ProbeResult Result, List<string> Sent)> Run(List<string> routine, bool inner, Dictionary<string, JsonElement>? options)
    {
        var sent = new List<string>();
        var controller = new Mock<ICncController>();
        controller.SetupGet(c => c.IsConnected).Returns(true);
        controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string cmd, CommandOptions? _, CancellationToken _) =>
            {
                sent.Add(cmd);
                if (cmd.StartsWith("G38.2 X") || cmd.StartsWith("G38.2 Y"))
                {
                    // The slow probe is the short one (3 mm or bounce + 1).
                    var slow = !cmd.Contains("30");
                    var (fast, s) = Touch(cmd, inner);
                    var v = (slow ? s : fast).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    var line = cmd[6] == 'X' ? $"[PRB:{v},0.000,-5.000:1]" : $"[PRB:0.000,{v},-5.000:1]";
                    controller.Raise(c => c.DataReceived += null, line, (string?)null);
                }
                return new CommandResult { Command = cmd, Status = "success" };
            });
        var context = new Mock<IServerContext>();
        context.SetupGet(c => c.State).Returns(new ServerState());
        var broadcaster = new Mock<IBroadcaster>();
        var service = new ProbeService(controller.Object, context.Object, broadcaster.Object, NullLogger<ProbeService>.Instance);
        return (await service.StartAsync(options, routine), sent);
    }

    private static Dictionary<string, JsonElement> Tip(double d) =>
        new() { ["toolDiameter"] = JsonSerializer.SerializeToElement(d) };

    [Fact]
    public async Task Inner_ReportsTheHoleSize()
    {
        var (result, _) = await Run(ThreeDProbeStrategy.GetCenterInnerRoutine(50, 30, 2), inner: true, Tip(2));
        Assert.Equal(50, result.MeasuredX);
        Assert.Equal(30, result.MeasuredY);
    }

    [Fact]
    public async Task Outer_ReportsThePartSize()
    {
        var (result, _) = await Run(ThreeDProbeStrategy.GetCenterOuterRoutine(50, 30, 2), inner: false, Tip(2));
        Assert.Equal(50, result.MeasuredX);
        Assert.Equal(30, result.MeasuredY);
    }

    [Fact]
    public async Task OtherRoutines_ReportNoSize()
    {
        var (result, _) = await Run(ThreeDProbeStrategy.GetXYProbeRoutine("BottomLeft", 2), inner: true, Tip(2));
        Assert.Null(result.MeasuredX);
        Assert.Null(result.MeasuredY);
    }

    [Fact]
    public async Task FailedTouch_ReportsNoSize()
    {
        var routine = ThreeDProbeStrategy.GetCenterInnerRoutine(50, 30, 2);
        var controller = new Mock<ICncController>();
        controller.SetupGet(c => c.IsConnected).Returns(true);
        controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string cmd, CommandOptions? _, CancellationToken _) =>
            {
                if (cmd.StartsWith("G38.2"))
                    controller.Raise(c => c.DataReceived += null, "[PRB:0.000,0.000,0.000:0]", (string?)null);
                return new CommandResult { Command = cmd, Status = "success" };
            });
        var context = new Mock<IServerContext>();
        context.SetupGet(c => c.State).Returns(new ServerState());
        var service = new ProbeService(controller.Object, context.Object, new Mock<IBroadcaster>().Object, NullLogger<ProbeService>.Instance);
        var result = await service.StartAsync(Tip(2), routine);
        Assert.Null(result.MeasuredX);
        Assert.Null(result.MeasuredY);
    }
}
