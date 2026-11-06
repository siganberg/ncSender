using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Core.Utils;

namespace NcSender.Server.Tests;

// $PARK does what holding the Park button does: Safe Z, then the saved
// parking location, read when the line runs.
public class ParkCommandTests
{
    private static (NcSender.Server.CommandProcessor.CommandProcessor Processor, CommandProcessorContext Ctx) Setup(
        string? location, MachineState ms, string units = "metric", string source = "client")
    {
        var settings = new Mock<ISettingsManager>();
        settings.Setup(s => s.GetSetting<string>("parkingLocation", It.IsAny<string>())).Returns(location!);
        settings.Setup(s => s.GetSetting<double>("safeZHeight", It.IsAny<double>())).Returns(-5);
        settings.Setup(s => s.GetSetting<string>("unitsPreference", It.IsAny<string>())).Returns(units);
        var context = new Mock<IServerContext>();
        context.Setup(c => c.State).Returns(new ServerState { MachineState = ms });
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        var firmware = new Mock<IFirmwareService>();
        firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync((FirmwareData?)null);
        var processor = new NcSender.Server.CommandProcessor.CommandProcessor(
            context.Object, broadcaster.Object, firmware.Object, settings.Object, new Mock<IMacroService>().Object,
            new NcSender.Server.CommandProcessor.ToolProjection(NullLogger<NcSender.Server.CommandProcessor.ToolProjection>.Instance),
            NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance);
        return (processor, new CommandProcessorContext { MachineState = ms, Meta = new CommandMeta { SourceId = source } });
    }

    private static List<string> Moves(CommandProcessorResult r) => r.Commands.Select(c => c.Command).ToList();

    [Fact]
    public async Task Park_GoesToSafeZThenAcross()
    {
        var (p, ctx) = Setup("2.007,2.006,-5.004", new MachineState { MPos = "100,200,-30", Homed = true, HomingCycle = 1 });
        var r = await p.ProcessAsync("$PARK", ctx);
        Assert.True(r.ShouldContinue);
        Assert.Equal(["G53 G21 G0 Z-5.0", "G53 G21 G0 X2.007 Y2.006"], Moves(r));
    }

    [Fact]
    public async Task Park_InInches_UsesTheUsersUnits()
    {
        var (p, ctx) = Setup("-25.4,-50.8,0", new MachineState { MPos = "0,0,0", Homed = true, HomingCycle = 1 }, "imperial");
        var r = await p.ProcessAsync("$park", ctx);
        Assert.Equal(["G53 G20 G0 Z-0.1969", "G53 G20 G0 X-1.0 Y-2.0"], Moves(r));
    }

    [Fact]
    public async Task Park_WithoutALocation_IsBlocked()
    {
        var (p, ctx) = Setup("", new MachineState { MPos = "0,0,0", Homed = true, HomingCycle = 1 });
        var r = await p.ProcessAsync("$PARK", ctx);
        Assert.False(r.ShouldContinue);
        Assert.Null(r.Error);
    }

    [Fact]
    public async Task Park_UnhomedWithHoming_IsBlocked_AndStopsAJob()
    {
        var (p, ctx) = Setup("2,2,-5", new MachineState { MPos = "0,0,0", Homed = false, HomingCycle = 1 }, source: "job");
        var r = await p.ProcessAsync("N120 $PARK", ctx);
        Assert.False(r.ShouldContinue);
        Assert.Contains("home", r.Error!);
    }

    [Theory]
    [InlineData("$PARK", true)]
    [InlineData("N55 $park", true)]
    [InlineData("$PARK (end of job)", true)]
    [InlineData("$PARK ; end", true)]
    [InlineData("$PARKX", false)]
    [InlineData("G0 X1", false)]
    public void Recognises_ThePark_Line(string line, bool expected) =>
        Assert.Equal(expected, GcodePatterns.IsParkCommand(line));
}
