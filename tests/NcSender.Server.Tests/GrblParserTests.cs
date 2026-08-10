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
        var dongle = new Mock<IDongleDeviceService>();
        return new CncController(NullLogger<CncController>.Instance, settings.Object, handlers, dongle.Object);
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
    public void GrblHal_NormalizePinState_NoActiveProbe_KeepsProbeOnly()
    {
        var protocol = new GrblHalProtocol();
        // -1 = active probe unknown (haven't seen a |P: change notification
        // yet, or first status after connect). We used to add "T" alongside
        // "P" as a "single-probe firmware" fallback — but grblHAL's |P: is a
        // one-shot notification, not per-report, so activeProbe genuinely
        // sits at -1 most of the time. Adding T on that basis lit BOTH probe
        // and toolsetter LEDs on every status update. New behaviour: when we
        // don't know which probe is active, assume the default (probe) and
        // show only P.
        Assert.Equal("XP", protocol.NormalizePinState("XP", -1));
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

    [Theory]
    [InlineData("[MSG:INFO: Current speed is 4638]", 4638)]
    [InlineData("[MSG:INFO: Current speed is 5982]", 5982)]
    public void FluidNC_TryHandleData_CurrentSpeed_UpdatesMeasuredRpm(string line, double expected)
    {
        var protocol = new FluidNcProtocol();
        // Spindle commanded on (target > 0).
        var state = new MachineState { SpindleRpmTarget = 5000, SpindleRpmActual = 1234 };

        // "Current speed is N" is the VFD's live measured rpm — it drives the gauge.
        var handled = protocol.TryHandleData(line, state, out var changed);

        Assert.True(handled);
        Assert.True(changed);
        Assert.Equal(expected, state.SpindleRpmActual);
    }

    [Fact]
    public void FluidNC_TryHandleData_CurrentSpeed_SameValue_NoStateChange()
    {
        var protocol = new FluidNcProtocol();
        var state = new MachineState { SpindleRpmTarget = 5000, SpindleRpmActual = 4638 };

        var handled = protocol.TryHandleData("[MSG:INFO: Current speed is 4638]", state, out var changed);

        Assert.True(handled);
        Assert.False(changed);
        Assert.Equal(4638, state.SpindleRpmActual);
    }

    [Fact]
    public void FluidNC_TryHandleData_CurrentSpeed_SpindleCommandedOff_Ignored()
    {
        var protocol = new FluidNcProtocol();
        // target == 0 => spindle commanded off (M5). Coast-down readings must not
        // bump the gauge back up.
        var state = new MachineState { SpindleRpmTarget = 0, SpindleRpmActual = 0 };

        var handled = protocol.TryHandleData("[MSG:INFO: Current speed is 234]", state, out var changed);

        Assert.True(handled);
        Assert.False(changed);
        Assert.Equal(0, state.SpindleRpmActual);
    }

    [Theory]
    [InlineData("[MSG:INFO: Syncing to 6000]")]
    [InlineData("[MSG:INFO: Synced speed to 6000]")]
    public void FluidNC_TryHandleData_DeviceUnitChatter_ConsumedButNeverTouchesRpm(string line)
    {
        var protocol = new FluidNcProtocol();
        var state = new MachineState { SpindleRpmTarget = 5000, SpindleRpmActual = 4638 };

        // These carry raw device units (Hz-based), not rpm — consumed to keep
        // them out of the terminal, but must never move the gauge.
        var handled = protocol.TryHandleData(line, state, out var changed);

        Assert.True(handled);
        Assert.False(changed);
        Assert.Equal(4638, state.SpindleRpmActual);
    }

    [Fact]
    public void FluidNC_PostProcessStatus_SpindleCommandedOff_GraduallyDrainsToZero()
    {
        var protocol = new FluidNcProtocol();
        // target == 0 (M5, with s0_with_disable) with the spindle still spinning.
        var state = new MachineState
        {
            MPos = "0,0,0",
            SpindleRpmTarget = 0,
            SpindleRpmActual = 5982,
        };

        // One status poll drains partway — not an instant snap to 0.
        protocol.PostProcessStatus(state, "Run");
        Assert.True(state.SpindleRpmActual > 0, "should not snap straight to 0");
        Assert.True(state.SpindleRpmActual < 5982, "should have drained");

        // Successive polls converge to exactly 0.
        for (var i = 0; i < 30; i++)
            protocol.PostProcessStatus(state, "Idle");
        Assert.Equal(0, state.SpindleRpmActual);
    }

    [Fact]
    public void FluidNC_PostProcessStatus_SpindleAlreadyStopped_StaysZero()
    {
        var protocol = new FluidNcProtocol();
        var state = new MachineState { MPos = "0,0,0", SpindleRpmTarget = 0, SpindleRpmActual = 0 };

        protocol.PostProcessStatus(state, "Idle");

        Assert.Equal(0, state.SpindleRpmActual);
    }

    [Fact]
    public void FluidNC_PostProcessStatus_SpindleCommandedOn_KeepsMeasuredRpm()
    {
        var protocol = new FluidNcProtocol();
        var state = new MachineState
        {
            MPos = "0,0,0",
            SpindleRpmTarget = 5000,
            SpindleRpmActual = 5982,
        };

        protocol.PostProcessStatus(state, "Run");

        Assert.Equal(5982, state.SpindleRpmActual);
    }

    [Fact]
    public void FluidNC_ShouldSuppressEcho_SpindleSyncChatter()
    {
        var protocol = new FluidNcProtocol();

        Assert.True(protocol.ShouldSuppressEcho("[MSG:INFO: Syncing to 6000]"));
        Assert.True(protocol.ShouldSuppressEcho("[MSG:INFO: Current speed is 144]"));
        Assert.True(protocol.ShouldSuppressEcho("[MSG:INFO: Synced speed to 6000]"));

        // Ordinary controller output must still reach the terminal.
        Assert.False(protocol.ShouldSuppressEcho("[MSG:INFO: FluidNC v4.0.3]"));
        Assert.False(protocol.ShouldSuppressEcho("ok"));
    }

    [Fact]
    public void FluidNC_TryHandleData_UnrelatedMessage_NotHandled()
    {
        var protocol = new FluidNcProtocol();
        var state = new MachineState();

        var handled = protocol.TryHandleData("[MSG:INFO: FluidNC v4.0.3]", state, out var changed);

        Assert.False(handled);
        Assert.False(changed);
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
