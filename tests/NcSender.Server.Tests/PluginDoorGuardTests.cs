using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// With the door open, M6 and $TLS are refused as a whole. $TLS used to get
// through: the per-line door rules dropped only its G0 lines (safe Z, the
// move over the setter) and the probe-down ran from wherever the spindle was.
public class PluginDoorGuardTests
{
    private static (NcSender.Server.CommandProcessor.PluginCommandProcessor Processor, List<int> PluginCalls)
        CreateProcessor(MachineState machineState)
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
        engine.Setup(e => e.GetLoadedPluginIds()).Returns(new List<string> { "changer" });
        engine.Setup(e => e.ProcessOnBeforeCommandAsync(
                It.IsAny<string>(), It.IsAny<List<ProcessedCommand>>(),
                It.IsAny<CommandProcessorContext>(), It.IsAny<List<ToolInfo>>()))
            .ReturnsAsync((string _, List<ProcessedCommand> cmds, CommandProcessorContext _, List<ToolInfo> _) =>
            {
                calls.Add(1);
                return new List<ProcessedCommand>
                {
                    new() { Command = "G53 G0 Z-5", IsOriginal = false },
                    new() { Command = "G38.2 Z-100 F300", IsOriginal = false }
                };
            });

        var tools = new Mock<IToolService>();
        tools.Setup(t => t.GetAllAsync()).ReturnsAsync(new List<ToolInfo>());

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
    [InlineData("$TLS")]
    [InlineData("M6 T5")]
    public async Task Door_open_blocks_the_whole_tool_change(string command)
    {
        var ms = new MachineState { Status = "Door", Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, calls) = CreateProcessor(ms);

        var result = await processor.ProcessAsync(command, Ctx(ms));

        Assert.False(result.ShouldContinue);
        Assert.Empty(calls);   // refused before any plugin builds a sequence
    }

    [Fact]
    public async Task Door_pin_alone_also_blocks_TLS()
    {
        // $61=1 setups: status stays Idle while the door pin is asserted.
        var ms = new MachineState { Status = "Idle", Pn = "D", Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, _) = CreateProcessor(ms);

        var result = await processor.ProcessAsync("$TLS", Ctx(ms));

        Assert.False(result.ShouldContinue);
    }

    [Fact]
    public async Task Door_closed_lets_TLS_run()
    {
        var ms = new MachineState { Status = "Idle", Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, calls) = CreateProcessor(ms);

        var result = await processor.ProcessAsync("$TLS", Ctx(ms));

        Assert.True(result.ShouldContinue);
        Assert.NotEmpty(calls);
    }

    [Fact]
    public async Task The_running_job_is_not_blocked_here()
    {
        // grblHAL holds a running program itself when the door opens.
        var ms = new MachineState { Status = "Door", Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var (processor, calls) = CreateProcessor(ms);

        await processor.ProcessAsync("M6 T5", Ctx(ms, "job"));

        Assert.NotEmpty(calls);
    }
}
