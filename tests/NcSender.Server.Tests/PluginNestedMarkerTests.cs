using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// A plugin marker (`$ADB_GOTO 32`) inside a tool changer's Pre/Post Tool
// Change event reached grblHAL raw: AutoDustBoot runs before the tool
// changers and only saw the M6. The host now runs each such line through the
// plugin chain once, and never again, so markers cannot loop.
public class PluginNestedMarkerTests
{
    private static NcSender.Server.CommandProcessor.PluginCommandProcessor CreateProcessor(
        MachineState machineState,
        Func<string, List<ProcessedCommand>, List<ProcessedCommand>> plugin,
        List<int>? calls = null)
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

        var engine = new Mock<IJsPluginEngine>();
        // Dust boot first (priority 10), tool changer second (50): the real order.
        engine.Setup(e => e.GetLoadedPluginIds()).Returns(new List<string> { "dustboot", "changer" });
        engine.Setup(e => e.ProcessOnBeforeCommandAsync(
                It.IsAny<string>(), It.IsAny<List<ProcessedCommand>>(),
                It.IsAny<CommandProcessorContext>(), It.IsAny<List<ToolInfo>>()))
            .ReturnsAsync((string id, List<ProcessedCommand> cmds, CommandProcessorContext _, List<ToolInfo> _) =>
            {
                calls?.Add(1);
                return plugin(id, cmds);
            });

        var tools = new Mock<IToolService>();
        tools.Setup(t => t.GetAllAsync()).ReturnsAsync(new List<ToolInfo>());

        return new NcSender.Server.CommandProcessor.PluginCommandProcessor(
            inner, engine.Object, tools.Object, serverContext.Object, broadcaster.Object,
            settings.Object, projection,
            NullLogger<NcSender.Server.CommandProcessor.PluginCommandProcessor>.Instance);
    }

    private static List<ProcessedCommand> Lines(params string[] lines) =>
        lines.Select(l => new ProcessedCommand { Command = l, IsOriginal = false }).ToList();

    private static bool IsOriginalOnly(List<ProcessedCommand> cmds, string text) =>
        cmds.Count == 1 && cmds[0].IsOriginal && cmds[0].Command.Trim() == text;

    private static CommandProcessorContext Ctx(MachineState ms) => new() { MachineState = ms, LineNumber = 1 };

    [Fact]
    public async Task A_marker_in_a_tool_change_event_is_expanded_by_its_plugin()
    {
        var ms = new MachineState { Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var processor = CreateProcessor(ms, (id, cmds) =>
        {
            if (id == "changer" && IsOriginalOnly(cmds, "M6 T5"))
                return Lines("M8", "$ADB_GOTO 32", "G53 G0 Z-5", "M61 Q5");
            if (id == "dustboot" && IsOriginalOnly(cmds, "$ADB_GOTO 32"))
                return Lines("G4 P0", "(DONGLE:autodustboot:goto:16182)");
            return cmds;
        });

        var result = await processor.ProcessAsync("M6 T5", Ctx(ms));
        var sent = result.Commands.Select(c => c.Command.Trim()).ToList();

        Assert.DoesNotContain("$ADB_GOTO 32", sent);
        var at = sent.IndexOf("(DONGLE:autodustboot:goto:16182)");
        Assert.True(at > sent.IndexOf("M8") && at < sent.IndexOf("G53 G0 Z-5"),
            "the expansion must sit where the marker was: " + string.Join(" | ", sent));
    }

    [Fact]
    public async Task A_marker_that_answers_with_itself_does_not_loop()
    {
        var ms = new MachineState { Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var calls = new List<int>();
        var processor = CreateProcessor(ms, (id, cmds) =>
        {
            if (id == "changer" && IsOriginalOnly(cmds, "M6 T5")) return Lines("$LOOP_ME", "M61 Q5");
            // Answers its marker with the same marker, as a separate expanded line.
            if (id == "dustboot" && IsOriginalOnly(cmds, "$LOOP_ME")) return Lines("G4 P0", "$LOOP_ME");
            return cmds;
        }, calls);

        var result = await processor.ProcessAsync("M6 T5", Ctx(ms));
        var sent = result.Commands.Select(c => c.Command.Trim()).ToList();

        Assert.Equal(1, sent.Count(c => c == "$LOOP_ME"));   // left as-is after one pass
        Assert.Equal(4, calls.Count);                          // 2 plugins x (M6 + one nested pass)
    }

    [Fact]
    public async Task Keepout_prefixed_rack_moves_are_not_rerun_through_plugins()
    {
        var ms = new MachineState { Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var calls = new List<int>();
        var processor = CreateProcessor(ms, (id, cmds) =>
            id == "changer" && IsOriginalOnly(cmds, "M6 T5")
                ? Lines("$keepout_off G53 G0 X150 Y150", "M61 Q5")
                : cmds, calls);

        await processor.ProcessAsync("M6 T5", Ctx(ms));

        Assert.Equal(2, calls.Count);   // only the M6 pass
    }

    [Fact]
    public async Task An_unclaimed_marker_is_sent_unchanged()
    {
        var ms = new MachineState { Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };
        var processor = CreateProcessor(ms, (id, cmds) =>
            id == "changer" && IsOriginalOnly(cmds, "M6 T5") ? Lines("$NOBODY_HOME 1", "M61 Q5") : cmds);

        var result = await processor.ProcessAsync("M6 T5", Ctx(ms));

        Assert.Contains(result.Commands, c => c.Command.Trim() == "$NOBODY_HOME 1");
    }
}
