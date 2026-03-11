using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

public class CommandProcessorTests
{
    private static (NcSender.Server.CommandProcessor.CommandProcessor Processor, Mock<IServerContext> Context, Mock<IBroadcaster> Broadcaster, Mock<IFirmwareService> Firmware, Mock<ISettingsManager> Settings)
        CreateProcessor(MachineState? machineState = null)
    {
        var context = new Mock<IServerContext>();
        var state = new ServerState();
        if (machineState is not null)
            state.MachineState = machineState;
        context.Setup(c => c.State).Returns(state);

        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        var firmware = new Mock<IFirmwareService>();
        firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync((FirmwareData?)null);

        var settings = new Mock<ISettingsManager>();

        var processor = new NcSender.Server.CommandProcessor.CommandProcessor(
            context.Object,
            broadcaster.Object,
            firmware.Object,
            settings.Object,
            NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance);

        return (processor, context, broadcaster, firmware, settings);
    }

    private static CommandProcessorContext CreateContext(MachineState? machineState = null) => new()
    {
        MachineState = machineState ?? new MachineState(),
        LineNumber = 1,
        Filename = "test.gcode"
    };

    // --- Door Safety ---

    [Fact]
    public async Task DoorActive_BlocksRapidMove()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Pn = "D" });

        var result = await processor.ProcessAsync("G0 X10", ctx);

        Assert.False(result.ShouldContinue);
        Assert.Contains("Door", result.SkipReason!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DoorActive_BlocksSpindleStart()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Status = "Door" });

        var result = await processor.ProcessAsync("M3 S12000", ctx);

        Assert.False(result.ShouldContinue);
        Assert.Contains("Door", result.SkipReason!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DoorActive_ClampsFeedRate()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Pn = "D" });

        var result = await processor.ProcessAsync("G1 X10 F5000", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Single(result.Commands);
        Assert.Contains("F1000", result.Commands[0].Command);
    }

    [Fact]
    public async Task DoorActive_LimitsJogFeedRate()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Pn = "D" });

        var result = await processor.ProcessAsync("$J=G21G91X10F5000", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Single(result.Commands);
        Assert.Contains("F1000", result.Commands[0].Command);
    }

    [Fact]
    public async Task DoorActive_DoesNotBlockJogAsRapid()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Pn = "D" });

        // Jog command should be feed-limited, not blocked as G0
        var result = await processor.ProcessAsync("$J=G21G91X10F500", ctx);

        Assert.True(result.ShouldContinue);
    }

    [Fact]
    public async Task NoDoor_AllowsRapidMove()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Pn = "" });

        var result = await processor.ProcessAsync("G0 X10", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Single(result.Commands);
        Assert.Equal("G0 X10", result.Commands[0].Command);
    }

    // --- Same-Tool M6 Skip ---

    [Fact]
    public async Task SameToolM6_Skipped()
    {
        var (processor, _, broadcaster, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Tool = 3 });

        var result = await processor.ProcessAsync("M6 T3", ctx);

        Assert.False(result.ShouldContinue);
        Assert.Contains("T3", result.SkipReason!);
        broadcaster.Verify(b => b.Broadcast("cnc-command", It.IsAny<JsonElement>()), Times.Once);
        broadcaster.Verify(b => b.Broadcast("cnc-command-result", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public async Task DifferentToolM6_PassesThrough()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Tool = 3, MPos = "100.000,200.000,0.000" });

        var result = await processor.ProcessAsync("M6 T5", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Equal(3, result.Commands.Count); // M6 + return + sentinel
        Assert.Equal("M6 T5", result.Commands[0].Command);
        Assert.Contains("G53 G21 G0 X100.000 Y200.000", result.Commands[1].Command);
        Assert.Contains("TOOL_CHANGE_COMPLETE", result.Commands[2].Command);
    }

    [Fact]
    public async Task M61_IsNotM6()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext(new MachineState { Tool = 1 });

        var result = await processor.ProcessAsync("M61Q2", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Single(result.Commands);
        Assert.Equal("M61Q2", result.Commands[0].Command);
        Assert.True(result.Commands[0].IsOriginal);
    }

    // --- M6 Tool Change Flag ---

    [Fact]
    public async Task M6_SetsIsToolChanging()
    {
        var machineState = new MachineState { Tool = 1 };
        var (processor, context, _, _, _) = CreateProcessor(machineState);
        var ctx = CreateContext(machineState);

        await processor.ProcessAsync("M6 T5", ctx);

        Assert.True(context.Object.State.MachineState.IsToolChanging);
    }

    [Fact]
    public async Task M6WithoutToolNumber_PassesThrough()
    {
        var machineState = new MachineState { Tool = 1 };
        var (processor, _, _, _, _) = CreateProcessor(machineState);
        var ctx = CreateContext(machineState);

        var result = await processor.ProcessAsync("M6", ctx);

        Assert.True(result.ShouldContinue);
        // M6 without tool number is matched but not "valid M6" (no tool number)
        // so no isToolChanging flag, just passthrough
    }

    // --- M6 Return-to-Position ---

    [Fact]
    public async Task M6_ManualInvocation_AddsReturnCommand()
    {
        var machineState = new MachineState { Tool = 1, MPos = "100.000,200.000,0.000" };
        var (processor, _, _, _, _) = CreateProcessor(machineState);
        var ctx = CreateContext(machineState);

        var result = await processor.ProcessAsync("M6 T5", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Equal(3, result.Commands.Count); // M6 + return + sentinel
        Assert.Contains("G53 G21 G0 X100.000 Y200.000", result.Commands[1].Command);
        Assert.Contains("TOOL_CHANGE_COMPLETE", result.Commands[2].Command);
    }

    [Fact]
    public async Task M6_ManualInvocation_ReturnCommand_InvariantCulture()
    {
        // Simulate European locale where comma is decimal separator
        var prev = System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
        try
        {
            var machineState = new MachineState { Tool = 1, MPos = "-859.459,-789.625,0.000" };
            var (processor, _, _, _, _) = CreateProcessor(machineState);
            var ctx = CreateContext(machineState);

            var result = await processor.ProcessAsync("M6 T5", ctx);

            Assert.True(result.ShouldContinue);
            Assert.Equal(3, result.Commands.Count);
            // Must use dot decimal separator, not comma
            Assert.Contains("G53 G21 G0 X-859.459 Y-789.625", result.Commands[1].Command);
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = prev;
        }
    }

    [Fact]
    public async Task M6_ProgramExecution_NoReturnCommand()
    {
        var machineState = new MachineState { Tool = 1, MPos = "100.000,200.000,0.000" };
        var (processor, _, _, _, _) = CreateProcessor(machineState);
        var ctx = CreateContext(machineState);
        ctx.NextXYPosition = new XyPosition { X = 50, Y = 75 };

        var result = await processor.ProcessAsync("M6 T5", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Equal(2, result.Commands.Count); // M6 + sentinel (no return command in program mode)
        Assert.Contains("TOOL_CHANGE_COMPLETE", result.Commands[1].Command);
    }

    // --- $TLS Handling ---

    [Fact]
    public async Task TLS_SetsIsToolChangingAndAddsSentinel()
    {
        var machineState = new MachineState { Tool = 1, MPos = "100.000,200.000,0.000" };
        var (processor, context, _, _, _) = CreateProcessor(machineState);
        var ctx = CreateContext(machineState);

        var result = await processor.ProcessAsync("$TLS", ctx);

        Assert.True(result.ShouldContinue);
        Assert.True(context.Object.State.MachineState.IsToolChanging);
        Assert.Equal(3, result.Commands.Count); // $TLS + return + sentinel
        Assert.Contains("G53 G21 G0 X100.000 Y200.000", result.Commands[1].Command);
        Assert.Contains("TOOL_CHANGE_COMPLETE", result.Commands[2].Command);
    }

    // --- $NCSENDER_CLEAR_MSG ---

    [Fact]
    public async Task ClearMsg_HandledWithoutSendingToController()
    {
        var (processor, _, broadcaster, _, _) = CreateProcessor();
        var ctx = CreateContext();

        var result = await processor.ProcessAsync("$NCSENDER_CLEAR_MSG", ctx);

        Assert.False(result.ShouldContinue);
        broadcaster.Verify(b => b.Broadcast("cnc-command", It.IsAny<JsonElement>()), Times.Once);
        broadcaster.Verify(b => b.Broadcast("cnc-command-result", It.IsAny<JsonElement>()), Times.Once);
    }

    // --- Default Passthrough ---

    [Fact]
    public async Task RegularCommand_PassesThrough()
    {
        var (processor, _, _, _, _) = CreateProcessor();
        var ctx = CreateContext();

        var result = await processor.ProcessAsync("G1 X10 Y20 F500", ctx);

        Assert.True(result.ShouldContinue);
        Assert.Single(result.Commands);
        Assert.Equal("G1 X10 Y20 F500", result.Commands[0].Command);
        Assert.True(result.Commands[0].IsOriginal);
    }
}
