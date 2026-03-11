using NcSender.Core.Constants;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using NcSender.Server.Protocols.GrblHal;
using NcSender.Server.Protocols.FluidNc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

public class GrblParserTests
{
    private static CncController CreateController()
    {
        var settings = new Mock<ISettingsManager>();
        settings.Setup(s => s.GetSetting<int>(It.IsAny<string>(), It.IsAny<int>())).Returns(100);
        IProtocolHandler[] handlers = [new GrblHalProtocol(), new FluidNcProtocol()];
        return new CncController(NullLogger<CncController>.Instance, settings.Object, handlers);
    }


    [Fact]
    public void ParseStatusReport_BasicIdleWithPositionAndFeed()
    {
        var controller = CreateController();
        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        controller.ParseStatusReport("<Idle|MPos:10.000,20.000,30.000|FS:1000,12000>");

        Assert.NotNull(received);
        Assert.Equal("Idle", received.Status);
        Assert.Equal("10.000,20.000,30.000", received.MPos);
        Assert.Equal(1000, received.FeedRate);
        Assert.Equal(12000, received.SpindleRpmTarget);
    }

    [Fact]
    public void ParseStatusReport_RunWithToolHomedOverridesAccessories()
    {
        var controller = CreateController();
        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        controller.ParseStatusReport("<Run|T:3|H:1|Ov:120,100,80|A:SF>");

        Assert.NotNull(received);
        Assert.Equal("Run", received.Status);
        Assert.Equal(3, received.Tool);
        Assert.True(received.Homed);
        Assert.Equal(120, received.FeedrateOverride);
        Assert.Equal(100, received.RapidOverride);
        Assert.Equal(80, received.SpindleOverride);
        Assert.True(received.SpindleActive);
        Assert.True(received.FloodCoolant);
        Assert.False(received.MistCoolant);
    }

    [Fact]
    public void ParseStatusReport_WithWCSAndPnAndProbe()
    {
        var controller = CreateController();
        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        controller.ParseStatusReport("<Idle|WCS:G55|Pn:XYZ|P:2>");

        Assert.NotNull(received);
        Assert.Equal("G55", received.Workspace);
        Assert.Equal("XYZ", received.Pn);
        Assert.Equal(2, received.ActiveProbe);
    }

    // --- Protocol Pn Normalization ---

    [Fact]
    public void GrblHal_NormalizePinState_ActiveProbe0_StaysP()
    {
        var protocol = new GrblHalProtocol();
        Assert.Equal("XP", protocol.NormalizePinState("XP", 0));
    }

    [Fact]
    public void GrblHal_NormalizePinState_ActiveProbe1_BecomesT()
    {
        var protocol = new GrblHalProtocol();
        Assert.Equal("XT", protocol.NormalizePinState("XP", 1));
    }

    [Fact]
    public void GrblHal_NormalizePinState_NoActiveProbe_BothPT()
    {
        var protocol = new GrblHalProtocol();
        // -1 = no P: field in status report → single-probe firmware, both LEDs
        Assert.Equal("XPT", protocol.NormalizePinState("XP", -1));
    }

    [Fact]
    public void FluidNC_NormalizePinState_ProbePassthrough()
    {
        var protocol = new FluidNcProtocol();
        // FluidNC reports P and T natively — no normalization
        Assert.Equal("XP", protocol.NormalizePinState("XP", -1));
    }

    [Fact]
    public void FluidNC_NormalizePinState_TLSPassthrough()
    {
        var protocol = new FluidNcProtocol();
        Assert.Equal("XT", protocol.NormalizePinState("XT", -1));
    }

    // --- Protocol Alarm Parsing ---

    [Fact]
    public void GrblHal_ParseAlarmLine_ValidFormat()
    {
        var protocol = new GrblHalProtocol();
        var result = protocol.ParseAlarmLine("[ALARMCODE:1||Hard limit]");
        Assert.NotNull(result);
        Assert.Equal("1", result.Value.Id);
        Assert.Equal("Hard limit", result.Value.Description);
    }

    [Fact]
    public void FluidNC_ParseAlarmLine_ValidFormat()
    {
        var protocol = new FluidNcProtocol();
        var result = protocol.ParseAlarmLine("1: Hard Limit");
        Assert.NotNull(result);
        Assert.Equal("1", result.Value.Id);
        Assert.Equal("Hard Limit", result.Value.Description);
    }

    [Fact]
    public void FluidNC_ParseAlarmLine_NonAlarmLine_ReturnsNull()
    {
        var protocol = new FluidNcProtocol();
        Assert.Null(protocol.ParseAlarmLine("ok"));
        Assert.Null(protocol.ParseAlarmLine("Input Matrix"));
    }

    [Fact]
    public void FluidNC_PostProcessStatus_AlwaysHomed()
    {
        var protocol = new FluidNcProtocol();
        var state = new MachineState { Status = "Idle", Homed = false };

        // FluidNC always reports as homed — no H: field in status reports
        protocol.PostProcessStatus(state, "Run");

        Assert.True(state.Homed);
    }

    [Fact]
    public void ParseStatusReport_ThreePartFS()
    {
        var controller = CreateController();
        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        controller.ParseStatusReport("<Run|FS:500,8000,7500>");

        Assert.NotNull(received);
        Assert.Equal(500, received.FeedRate);
        Assert.Equal(8000, received.SpindleRpmTarget);
        Assert.Equal(7500, received.SpindleRpmActual);
    }

    [Fact]
    public void ParseStatusReport_BufferAndLineNumber()
    {
        var controller = CreateController();
        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        controller.ParseStatusReport("<Run|Bf:15,128|Ln:42>");

        Assert.NotNull(received);
        Assert.Equal(15, received.Bf[0]);
        Assert.Equal(128, received.Bf[1]);
        Assert.Equal(42, received.Ln);
    }

    [Fact]
    public void GrblErrors_KnownCode_ReturnsDescription()
    {
        var msg = GrblErrors.GetMessage(22);
        Assert.Equal("Feed rate has not yet been set or is undefined.", msg);
    }

    [Fact]
    public void GrblErrors_UnknownCode_ReturnsUnknown()
    {
        var msg = GrblErrors.GetMessage(999);
        Assert.Equal("Unknown error", msg);
    }

    [Fact]
    public void GrblAlarms_KnownCode_ReturnsDescription()
    {
        var msg = GrblAlarms.GetMessage(1);
        Assert.Contains("Hard limit", msg);
    }

    [Fact]
    public void GrblAlarms_UnknownCode_ReturnsUnknown()
    {
        var msg = GrblAlarms.GetMessage(999);
        Assert.Equal("Unknown alarm", msg);
    }

    [Fact]
    public void ParseStatusReport_AccessoryFieldEmpty_AllOff()
    {
        var controller = CreateController();

        // First set accessories on
        controller.ParseStatusReport("<Run|A:SFM>");

        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        // A: field present but empty = all off
        controller.ParseStatusReport("<Run|A:>");

        Assert.NotNull(received);
        Assert.False(received.SpindleActive);
        Assert.False(received.FloodCoolant);
        Assert.False(received.MistCoolant);
    }

    [Fact]
    public void ParseStatusReport_WCO()
    {
        var controller = CreateController();
        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        controller.ParseStatusReport("<Idle|WCO:1.000,2.000,3.000>");

        Assert.NotNull(received);
        Assert.Equal("1.000,2.000,3.000", received.WCO);
    }

    [Fact]
    public void ParseStatusReport_FSArray_ComputedFromIndividualFields()
    {
        var controller = CreateController();
        MachineState? received = null;
        controller.StatusReportReceived += s => received = s;

        controller.ParseStatusReport("<Run|FS:1500,9000,8500>");

        Assert.NotNull(received);
        Assert.Equal(new double[] { 1500, 9000, 8500 }, received.FS);
    }
}
