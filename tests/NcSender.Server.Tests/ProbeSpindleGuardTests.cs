using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// A probe, drag knife or pen in the spindle must never turn. M3/M4 is refused
// while one is loaded, from every source; in a job it stops the job.
public class ProbeSpindleGuardTests
{
    private static (NcSender.Server.CommandProcessor.PluginCommandProcessor Processor, List<int> PluginCalls)
        CreateProcessor(MachineState machineState, bool pluginsLoaded = true)
    {
        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState { MachineState = machineState });

        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        var firmware = new Mock<IFirmwareService>();
        firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync((FirmwareData?)null);

        var settings = new Mock<ISettingsManager>();
        var projection = new NcSender.Server.CommandProcessor.ToolProjection(
            NullLogger<NcSender.Server.CommandProcessor.ToolProjection>.Instance);
        var inner = new NcSender.Server.CommandProcessor.CommandProcessor(
            serverContext.Object, broadcaster.Object, firmware.Object, settings.Object,
            new Mock<IMacroService>().Object, projection,
            NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance);

        var calls = new List<int>();
        var engine = new Mock<IJsPluginEngine>();
        engine.Setup(e => e.GetLoadedPluginIds()).Returns(pluginsLoaded ? new List<string> { "changer" } : new List<string>());
        engine.Setup(e => e.ProcessOnBeforeCommandAsync(
                It.IsAny<string>(), It.IsAny<List<ProcessedCommand>>(),
                It.IsAny<CommandProcessorContext>(), It.IsAny<List<ToolInfo>>()))
            .ReturnsAsync((string _, List<ProcessedCommand> cmds, CommandProcessorContext _, List<ToolInfo> _) =>
            {
                calls.Add(1);
                return cmds;
            });

        var tools = new Mock<IToolService>();
        tools.Setup(t => t.GetAllAsync()).ReturnsAsync(new List<ToolInfo>
        {
            new() { Id = 1, ToolId = 1, ToolNumber = 1, Type = "flat" },
            new() { Id = 5, ToolId = 5, ToolNumber = 5, Type = "drag-knife" },
            new() { Id = 6, ToolId = 6, ToolNumber = 6, Type = "Pen" },
            new() { Id = 99, ToolId = 99, ToolNumber = 99, Type = "probe" },
        });

        var processor = new NcSender.Server.CommandProcessor.PluginCommandProcessor(
            inner, engine.Object, tools.Object, serverContext.Object, broadcaster.Object,
            settings.Object, projection,
            NullLogger<NcSender.Server.CommandProcessor.PluginCommandProcessor>.Instance);
        return (processor, calls);
    }

    private static CommandProcessorContext Ctx(MachineState ms, string? source = "client") => new()
    {
        MachineState = ms,
        LineNumber = 1,
        Meta = new CommandMeta { SourceId = source }
    };

    [Theory]
    [InlineData("M3 S10000")]
    [InlineData("M03 S8000")]
    [InlineData("M4")]
    [InlineData("S12000 M3")]
    public async Task Spindle_start_is_refused_with_a_probe_loaded(string command)
    {
        var ms = new MachineState { Status = "Idle", Tool = 99, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, calls) = CreateProcessor(ms);

        var result = await processor.ProcessAsync(command, Ctx(ms));

        Assert.False(result.ShouldContinue);
        Assert.Null(result.Error);   // manual: skipped, nothing to stop
        Assert.Empty(calls);
    }

    [Fact]
    public async Task Spindle_start_with_a_probe_loaded_stops_the_job()
    {
        var ms = new MachineState { Status = "Run", Tool = 99, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, _) = CreateProcessor(ms);

        var result = await processor.ProcessAsync("M3 S10000", Ctx(ms, "job"));

        Assert.False(result.ShouldContinue);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public async Task Refused_even_with_no_plugins_loaded()
    {
        var ms = new MachineState { Status = "Idle", Tool = 99, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, _) = CreateProcessor(ms, pluginsLoaded: false);

        var result = await processor.ProcessAsync("M3 S10000", Ctx(ms));

        Assert.False(result.ShouldContinue);
    }

    [Theory]
    [InlineData("M3 S10000", 1)]      // a cutter: spins as normal
    [InlineData("M5", 99)]            // stopping is always allowed
    [InlineData("M30", 99)]           // program end, not M3
    [InlineData("M35", 99)]
    [InlineData("G0 X10 (M3)", 99)]   // only in a comment
    [InlineData("G0 X10 ; M4", 99)]
    public async Task Other_commands_pass(string command, int tool)
    {
        var ms = new MachineState { Status = "Idle", Tool = tool, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, _) = CreateProcessor(ms);

        var result = await processor.ProcessAsync(command, Ctx(ms));

        Assert.True(result.ShouldContinue);
    }

    [Theory]
    [InlineData(5, "M3 S10000")]   // drag knife
    [InlineData(5, "M4")]
    [InlineData(6, "M03 S1000")]   // pen (set up as "Pen": the guard ignores case)
    [InlineData(6, "S12000 M3")]
    public async Task Spindle_start_is_refused_with_a_drag_knife_or_pen_loaded(int tool, string command)
    {
        var ms = new MachineState { Status = "Idle", Tool = tool, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, calls) = CreateProcessor(ms);

        var result = await processor.ProcessAsync(command, Ctx(ms));

        Assert.False(result.ShouldContinue);
        Assert.Null(result.Error);
        Assert.Empty(calls);
    }

    [Theory]
    [InlineData(5, "drag knife")]
    [InlineData(6, "pen")]
    public async Task Spindle_start_with_a_drag_knife_or_pen_loaded_stops_the_job(int tool, string label)
    {
        var ms = new MachineState { Status = "Run", Tool = tool, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, _) = CreateProcessor(ms);

        var result = await processor.ProcessAsync("M3 S10000", Ctx(ms, "job"));

        Assert.False(result.ShouldContinue);
        Assert.Equal($"T{tool} is a {label}, the spindle can't turn", result.Error);
    }

    [Fact]
    public async Task Spindle_start_after_a_queued_change_to_a_pen_is_refused()
    {
        var ms = new MachineState { Status = "Idle", Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, _) = CreateProcessor(ms, pluginsLoaded: false);

        await processor.ProcessAsync("M6 T6", Ctx(ms));
        var result = await processor.ProcessAsync("M3 S10000", Ctx(ms));

        Assert.False(result.ShouldContinue);
    }

    [Theory]
    [InlineData("M5", 5)]
    [InlineData("M30", 6)]
    [InlineData("G1 X10 F500 (M3)", 5)]
    public async Task Other_commands_pass_with_a_drag_knife_or_pen_loaded(string command, int tool)
    {
        var ms = new MachineState { Status = "Idle", Tool = tool, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, _) = CreateProcessor(ms);

        var result = await processor.ProcessAsync(command, Ctx(ms));

        Assert.True(result.ShouldContinue);
    }
}
