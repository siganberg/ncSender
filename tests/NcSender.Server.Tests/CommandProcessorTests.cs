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

        var macros = new Mock<IMacroService>();

        var processor = new NcSender.Server.CommandProcessor.CommandProcessor(
            context.Object,
            broadcaster.Object,
            firmware.Object,
            settings.Object,
            macros.Object,
            NewProjection(),
            NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance);

        return (processor, context, broadcaster, firmware, settings);
    }

    private static NcSender.Server.CommandProcessor.ToolProjection NewProjection() =>
        new(NullLogger<NcSender.Server.CommandProcessor.ToolProjection>.Instance);

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

    // --- M98 Macro Expansion ---

    private static NcSender.Server.CommandProcessor.CommandProcessor CreateProcessorWithMacro(
        int macroId, string name, string body, MachineState machineState)
    {
        var context = new Mock<IServerContext>();
        var state = new ServerState { MachineState = machineState };
        context.Setup(c => c.State).Returns(state);

        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        var firmware = new Mock<IFirmwareService>();
        firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync((FirmwareData?)null);

        var macros = new Mock<IMacroService>();
        macros.Setup(m => m.GetMacro(macroId))
            .Returns(new MacroInfo { Id = macroId, Name = name, Body = body });

        return new NcSender.Server.CommandProcessor.CommandProcessor(
            context.Object,
            broadcaster.Object,
            firmware.Object,
            new Mock<ISettingsManager>().Object,
            macros.Object,
            NewProjection(),
            NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance);
    }

    /// <summary>Records every line handed to it, then delegates to the real processor.</summary>
    private sealed class RecordingPipeline : ICommandProcessor
    {
        private readonly ICommandProcessor _inner;
        public List<string> Seen { get; } = [];

        public RecordingPipeline(ICommandProcessor inner) => _inner = inner;

        public Task<CommandProcessorResult> ProcessAsync(string command, CommandProcessorContext context)
        {
            Seen.Add(command);
            return _inner.ProcessAsync(command, context);
        }
    }

    [Fact]
    public async Task MacroBody_LinesRoutedThroughOuterPipeline()
    {
        // Regression: macro body lines used to recurse into CommandProcessor
        // directly, so plugin onBeforeCommand (e.g. RapidChangeATC's M6
        // handler) never saw them and the raw M6 hit the controller.
        var processor = CreateProcessorWithMacro(
            9005, "Tool Change Test", "M6 T1\nG4 P2", new MachineState { Tool = 0 });
        var pipeline = new RecordingPipeline(processor);
        processor.Pipeline = pipeline;

        var result = await processor.ProcessAsync("M98 P9005", CreateContext(new MachineState { Tool = 0 }));

        Assert.True(result.ShouldContinue);
        Assert.Equal(["M6 T1", "G4 P2"], pipeline.Seen);
    }

    [Fact]
    public async Task MacroBody_SecondM6_NotSkippedByExpansionTimeTool()
    {
        // Regression: the same-tool check read live MachineState.Tool for
        // every body line, but expansion is eager — so with T0 loaded the
        // trailing "M6 T0" was compared against the pre-macro tool and
        // silently dropped even though "M6 T1" runs before it.
        var machineState = new MachineState { Tool = 0 };
        var processor = CreateProcessorWithMacro(
            9005, "Tool Change Test", "M6 T1\nG4 P2\nM6 T0", machineState);

        var result = await processor.ProcessAsync("M98 P9005", CreateContext(machineState));

        Assert.True(result.ShouldContinue);
        var sent = result.Commands.Select(c => c.Command).ToList();
        Assert.Contains("M6 T1", sent);
        Assert.Contains("M6 T0", sent);
    }

    [Fact]
    public async Task MacroBody_GenuineSameToolM6_StillSkipped()
    {
        // The projected tool must still suppress a redundant change: the
        // second "M6 T1" is a no-op because the first one loaded T1.
        var machineState = new MachineState { Tool = 0 };
        var processor = CreateProcessorWithMacro(
            9006, "Double Load", "M6 T1\nM6 T1", machineState);

        var result = await processor.ProcessAsync("M98 P9006", CreateContext(machineState));

        Assert.True(result.ShouldContinue);
        var sent = result.Commands.Select(c => c.Command).ToList();
        Assert.Single(sent, c => c == "M6 T1");
    }

    [Fact]
    public async Task SeparateDispatches_MiddleM6_NotSkippedAgainstStaleTool()
    {
        // Regression (broke a cutter): the console dispatches pasted lines as
        // fast as the WebSocket accepts them, so all three M6s were expanded
        // before the first one executed. Against raw MachineState.Tool the
        // "M6 T0" looked like a same-tool no-op and was dropped, leaving two
        // consecutive load cycles that drove a tool into an occupied collet.
        var machineState = new MachineState { Tool = 0 };
        var (processor, _, _, _, _) = CreateProcessor(machineState);

        var load = await processor.ProcessAsync("M6 T1", CreateContext(machineState));
        var unload = await processor.ProcessAsync("M6 T0", CreateContext(machineState));
        var reload = await processor.ProcessAsync("M6 T1", CreateContext(machineState));

        Assert.True(load.ShouldContinue);
        Assert.True(unload.ShouldContinue);
        Assert.True(reload.ShouldContinue);
        Assert.Contains("M6 T0", unload.Commands.Select(c => c.Command));
    }

    [Fact]
    public async Task SeparateDispatches_RedundantM6_StillSkipped()
    {
        // The projection must not turn every M6 into a real change.
        var machineState = new MachineState { Tool = 0 };
        var (processor, _, _, _, _) = CreateProcessor(machineState);

        await processor.ProcessAsync("M6 T1", CreateContext(machineState));
        var again = await processor.ProcessAsync("M6 T1", CreateContext(machineState));

        Assert.False(again.ShouldContinue);
    }

    [Fact]
    public async Task MacroBody_FirstM6MatchingLoadedTool_IsSkipped()
    {
        // T1 already in the spindle — the leading "M6 T1" is redundant, but
        // the trailing "M6 T0" must still go out.
        var machineState = new MachineState { Tool = 1 };
        var processor = CreateProcessorWithMacro(
            9005, "Tool Change Test", "M6 T1\nG4 P2\nM6 T0", machineState);

        var result = await processor.ProcessAsync("M98 P9005", CreateContext(machineState));

        Assert.True(result.ShouldContinue);
        var sent = result.Commands.Select(c => c.Command).ToList();
        Assert.DoesNotContain("M6 T1", sent);
        Assert.Contains("M6 T0", sent);
    }
}
