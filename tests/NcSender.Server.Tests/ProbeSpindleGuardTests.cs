using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// A probe in the spindle must never turn. M3/M4 is refused while the loaded
// tool is a probe, from every source; in a job it stops the job.
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
}
