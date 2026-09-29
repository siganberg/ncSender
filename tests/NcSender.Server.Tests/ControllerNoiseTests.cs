using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using NcSender.Server.Protocols.FluidNc;
using NcSender.Server.Protocols.GrblHal;

namespace NcSender.Server.Tests;

// Lines captured on the kiosk after a soft reset inside a grblHAL motor-fault
// alarm (Alarm 17, SuperLongBoard Ext, 2026-09-28). They used to crash the
// status parser (dropping the connection into a reset/reconnect loop) and
// flood the terminal every poll.
public class ControllerNoiseTests
{
    private const string Spaces = "                                                                        ";
    private const string TornPair =
        Spaces + "<Alarm|MPos:0.000,0.000,0.000,0.000|Bf:128,1024|FS:0,0,0|Pn:F>"
        + "Pn:F|WCO:367.000,-645.000,13.725,-46.626|WCS:G54|Ov:100,100,100|A:|Sc:|MPG:0|H:0,0|T:3|P:0|TLR:0|SD:1|FW:grblHAL|$C:1>";

    private static CncController CreateController()
    {
        var settings = new Mock<ISettingsManager>();
        settings.Setup(s => s.GetSetting<int>(It.IsAny<string>(), It.IsAny<int>())).Returns(100);
        IProtocolHandler[] handlers = [new GrblHalProtocol(), new FluidNcProtocol()];
        return new CncController(NullLogger<CncController>.Instance, settings.Object, handlers,
            new Mock<IDongleDeviceService>().Object);
    }

    [Theory]
    [InlineData(">")]
    [InlineData("<>")]
    [InlineData("O:367.000,-645.000,13.725,-46.626>")]
    [InlineData("<Alarm:17|MPos:0.000,0.000,0.000,0.000|Bf:128,1021|FS:0,0,0|S:0|Pn:F|FW:gr")]
    [InlineData(Spaces)]
    [InlineData("")]
    public void Noise_IsRecognised(string line) => Assert.True(CncController.IsControllerNoise(line));

    [Theory]
    [InlineData("<Idle|MPos:0.000,0.000,0.000,0.000|Bf:128,1024|FS:0,0,0>")]
    [InlineData("ok")]
    [InlineData("error:79")]
    [InlineData("[MSG:Motor fault - clear, then reset to continue]")]
    [InlineData("[PINSTATE:DIN|P3 <- Laser enable|15|NU--|IB--|1]")]
    [InlineData("GrblHAL 1.1f ['$' or '$HELP' for help]")]
    public void RealLines_AreNotNoise(string line) => Assert.False(CncController.IsControllerNoise(line));

    [Fact]
    public void TornStatusLines_NeitherCrashNorReachTheTerminal()
    {
        var controller = CreateController();
        var statuses = new List<string>();
        var terminal = new List<string>();
        controller.StatusReportReceived += s => statuses.Add(s.Status);
        controller.DataReceived += (d, _) => terminal.Add(d);

        var lines = new List<string>();
        TransportLineFramer.CollectLineWithStatusSplice(TornPair, lines);
        lines.Add("O:367.000,-645.000,13.725,-46.626>");
        lines.Add(">");
        lines.Add(Spaces);

        foreach (var line in lines)
            controller.HandleIncomingData(line);

        Assert.All(statuses, s => Assert.Equal("Alarm", s));
        Assert.DoesNotContain(terminal, t => string.IsNullOrWhiteSpace(t) || t.EndsWith('>'));
    }

    [Fact]
    public void Dispatch_ThrowingHandler_SkipsTheLineOnly()
    {
        var seen = new List<string>();
        Action<string> handler = line =>
        {
            if (line == "boom") throw new ArgumentOutOfRangeException("length");
            seen.Add(line);
        };

        TransportLineFramer.Dispatch(handler, "ok");
        TransportLineFramer.Dispatch(handler, "boom");
        TransportLineFramer.Dispatch(handler, "<Idle|MPos:0,0,0>");

        Assert.Equal(["ok", "<Idle|MPos:0,0,0>"], seen);
    }
}
