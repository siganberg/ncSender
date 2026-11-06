using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Core.Utils;

namespace NcSender.Server.Tests;

// $SAFEZ raises to Safe Z in the units the parser will be in when it runs,
// without changing them.
public class SafeZCommandTests
{
    private static (NcSender.Server.CommandProcessor.CommandProcessor Processor, CommandProcessorContext Ctx) Setup(
        string? queuedUnits, MachineState? ms = null, string source = "client", Mock<IMacroService>? macros = null)
    {
        ms ??= new MachineState { MPos = "0,0,-30", Homed = true, HomingCycle = 1 };
        var settings = new Mock<ISettingsManager>();
        settings.Setup(s => s.GetSetting<double>("safeZHeight", It.IsAny<double>())).Returns(-5);
        settings.Setup(s => s.GetSetting<string>("unitsPreference", It.IsAny<string>())).Returns("imperial");
        var context = new Mock<IServerContext>();
        context.Setup(c => c.State).Returns(new ServerState { MachineState = ms });
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        var firmware = new Mock<IFirmwareService>();
        firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync((FirmwareData?)null);
        var controller = new Mock<ICncController>();
        controller.Setup(c => c.QueuedUnits).Returns(queuedUnits);
        var processor = new NcSender.Server.CommandProcessor.CommandProcessor(
            context.Object, broadcaster.Object, firmware.Object, settings.Object, (macros ?? new Mock<IMacroService>()).Object,
            new NcSender.Server.CommandProcessor.ToolProjection(NullLogger<NcSender.Server.CommandProcessor.ToolProjection>.Instance),
            NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance,
            controller: controller.Object);
        return (processor, new CommandProcessorContext { MachineState = ms, Meta = new CommandMeta { SourceId = source } });
    }

    private static List<string> Moves(CommandProcessorResult r) => r.Commands.Select(c => c.Command).ToList();

    [Fact]
    public async Task InMetric_SendsMillimetresWithoutAUnitsWord()
    {
        var (p, ctx) = Setup("G21");
        var r = await p.ProcessAsync("$SAFEZ", ctx);
        Assert.True(r.ShouldContinue);
        Assert.Equal(["G53 G0 Z-5.0"], Moves(r));
    }

    [Fact]
    public async Task InInches_SendsInchesWithoutAUnitsWord()
    {
        var (p, ctx) = Setup("G20");
        var r = await p.ProcessAsync("N40 $safez (retract)", ctx);
        Assert.Equal(["G53 G0 Z-0.1969"], Moves(r));
    }

    [Fact]
    public async Task UnknownUnits_SaysMillimetresOutright()
    {
        var (p, ctx) = Setup(null);
        var r = await p.ProcessAsync("$SAFEZ", ctx);
        Assert.Equal(["G53 G21 G0 Z-5.0"], Moves(r));
    }

    [Fact]
    public async Task UnhomedWithHoming_IsBlocked_AndStopsAJob()
    {
        var (p, ctx) = Setup("G21", new MachineState { MPos = "0,0,0", Homed = false, HomingCycle = 1 }, source: "job");
        var r = await p.ProcessAsync("$SAFEZ", ctx);
        Assert.False(r.ShouldContinue);
        Assert.Equal("Safe Z: home the machine first", r.Error);
    }

    [Fact]
    public async Task InAMacro_UsesTheUnitsAnEarlierBodyLineSet()
    {
        var macros = new Mock<IMacroService>();
        macros.Setup(m => m.GetMacro(9007)).Returns(new MacroInfo { Id = 9007, Name = "retract", Body = "G20\n$SAFEZ\nG21\n$SAFEZ" });
        var (p, ctx) = Setup("G21", macros: macros);
        var r = await p.ProcessAsync("M98 P9007", ctx);
        var moves = Moves(r).Where(c => c.StartsWith("G53")).ToList();
        Assert.Equal(["G53 G0 Z-0.1969", "G53 G0 Z-5.0"], moves);
    }

    [Theory]
    [InlineData("$SAFEZ", true)]
    [InlineData("N12 $safez", true)]
    [InlineData("$SAFEZ ; up", true)]
    [InlineData("$SAFEZX", false)]
    [InlineData("$PARK", false)]
    public void Recognises_TheSafeZLine(string line, bool expected) =>
        Assert.Equal(expected, GcodePatterns.IsSafeZCommand(line));

    [Theory]
    [InlineData("G20", "G20")]
    [InlineData("G21 G90", "G21")]
    [InlineData("N10 G90 G20 G0 X1", "G20")]
    [InlineData("G020", "G20")]
    [InlineData("G20 G21", "G21")]
    [InlineData("G0 X1 (G20 here)", null)]
    [InlineData("G0 X1 ; G20", null)]
    [InlineData("G200", null)]
    [InlineData("G2 X1 Y1 I1", null)]
    [InlineData("$J=G20 G91 X1 F10", null)]
    [InlineData("$N0=G20", null)]
    public void UnitsWord_ReadsTheLastG20OrG21(string line, string? expected) =>
        Assert.Equal(expected, GcodePatterns.UnitsWord(line));
}
