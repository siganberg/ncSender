using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Tests;

// A refused line stops the macro there: the lines before it still run, the
// rest don't. Lines that are only handled without sending don't stop it.
public class MacroRefusalTests
{
    private static (NcSender.Server.CommandProcessor.CommandProcessor Processor, CommandProcessorContext Ctx) Setup(
        Dictionary<int, string> bodies, MachineState ms, string source = "macro", string? name = null)
    {
        var settings = new Mock<ISettingsManager>();
        settings.Setup(s => s.GetSetting<string>("parkingLocation", It.IsAny<string>())).Returns("2,2,-5");
        settings.Setup(s => s.GetSetting<double>("safeZHeight", It.IsAny<double>())).Returns(-5);
        settings.Setup(s => s.GetSetting<string>("unitsPreference", It.IsAny<string>())).Returns("metric");
        settings.Setup(s => s.RemoveSetting(It.IsAny<string>())).Returns(Task.CompletedTask);
        var context = new Mock<IServerContext>();
        context.Setup(c => c.State).Returns(new ServerState { MachineState = ms });
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        var firmware = new Mock<IFirmwareService>();
        firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync((FirmwareData?)null);
        var macros = new Mock<IMacroService>();
        foreach (var (id, body) in bodies)
            macros.Setup(m => m.GetMacro(id)).Returns(new MacroInfo { Id = id, Name = name ?? $"m{id}", Body = body });
        var processor = new NcSender.Server.CommandProcessor.CommandProcessor(
            context.Object, broadcaster.Object, firmware.Object, settings.Object, macros.Object,
            new NcSender.Server.CommandProcessor.ToolProjection(NullLogger<NcSender.Server.CommandProcessor.ToolProjection>.Instance),
            NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance);
        return (processor, new CommandProcessorContext { MachineState = ms, Meta = new CommandMeta { SourceId = source } });
    }

    private static readonly MachineState Unhomed = new() { MPos = "0,0,-30", Homed = false, HomingCycle = 1 };
    private static List<string> Lines(CommandProcessorResult r) =>
        r.Commands.Select(c => c.Command).Where(c => !c.StartsWith('(')).ToList();

    [Fact]
    public async Task RefusedLine_StopsTheRestOfTheMacro()
    {
        var (p, ctx) = Setup(new() { [9001] = "G0 X1\n$PARK\nG0 X2" }, Unhomed);
        var r = await p.ProcessAsync("M98 P9001", ctx);
        Assert.True(r.Refused);
        Assert.Null(r.Error);
        Assert.Equal(["G0 X1"], Lines(r));
        Assert.Contains(r.Commands, c => c.Command.StartsWith("(Macro m9001 stopped:"));
        Assert.DoesNotContain(r.Commands, c => c.Command.StartsWith("(End macro"));
    }

    [Fact]
    public async Task InAJob_TheRefusalStopsTheJob()
    {
        var (p, ctx) = Setup(new() { [9001] = "$PARK\nG0 X2" }, Unhomed, source: "job");
        var r = await p.ProcessAsync("N10 M98 P9001", ctx);
        Assert.Equal("Park: home the machine first", r.Error);
    }

    [Fact]
    public async Task DoorBlockedRapid_StopsTheMacro_AndAJobGetsAnError()
    {
        var door = new MachineState { MPos = "0,0,-5", Status = "Door", Homed = true, HomingCycle = 1 };
        var (p, ctx) = Setup(new() { [9001] = "G0 X5\nG1 X2 F100" }, door, source: "job");
        var r = await p.ProcessAsync("M98 P9001", ctx);
        Assert.True(r.Refused);
        Assert.Empty(Lines(r));
        Assert.StartsWith("Macro m9001: Command blocked", r.Error);
    }

    [Fact]
    public async Task HandledLine_DoesNotStopTheMacro()
    {
        var homed = new MachineState { MPos = "0,0,-5", Homed = true, HomingCycle = 1 };
        var (p, ctx) = Setup(new() { [9001] = "$NCSENDER_CLEAR_MSG\nG0 X1" }, homed);
        var r = await p.ProcessAsync("M98 P9001", ctx);
        Assert.False(r.Refused);
        Assert.Equal(["G0 X1"], Lines(r));
        Assert.Contains(r.Commands, c => c.Command == "(End macro: m9001)");
    }

    [Fact]
    public async Task MacroNameAndReason_CannotEndTheCommentEarly()
    {
        var macros = new Dictionary<int, string> { [9001] = "$PARK" };
        var (p, ctx) = Setup(macros, Unhomed, name: "Probe (XY)");
        var r = await p.ProcessAsync("M98 P9001", ctx);
        Assert.Contains(r.Commands, c => c.Command.StartsWith("(Macro Probe [XY] stopped:"));
        Assert.All(r.Commands.Where(c => c.Command.StartsWith('(')),
            c => Assert.Equal(1, c.Command.Count(ch => ch == ')')));
    }

    [Fact]
    public async Task RefusalInANestedMacro_StopsTheOuterOneToo()
    {
        var (p, ctx) = Setup(new() { [9001] = "G0 X1\nM98 P9002\nG0 X9", [9002] = "G0 X3\n$PARK\nG0 X4" }, Unhomed);
        var r = await p.ProcessAsync("M98 P9001", ctx);
        Assert.True(r.Refused);
        Assert.Equal(["G0 X1", "G0 X3"], Lines(r));
    }
}
