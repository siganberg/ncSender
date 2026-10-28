using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Protocols.FluidNc;
using NcSender.Server.Protocols.Grbl;
using NcSender.Server.Protocols.GrblHal;

namespace NcSender.Server.Tests;

// Tool changer plugins wrap a change in M51 (hold the spindle override at
// 100%) only when the controller understands it, or when its translator takes
// the M51 out (FluidNC): a rejected line stops the tool change.
public class ProtocolCapabilityTests
{
    [Fact]
    public void GrblHal_supports_override_control() =>
        Assert.True(((IProtocolHandler)new GrblHalProtocol()).SupportsOverrideControl);

    [Fact]
    public void FluidNc_takes_override_control_through_its_translator()
    {
        IProtocolHandler p = new FluidNcProtocol();
        Assert.True(p.SupportsOverrideControl);
        Assert.IsType<FluidNcTranslator>(p.CreateTranslator(() => new MachineState()));
    }

    // FluidNC reports no WCS: or T:, so the parser state is read back after
    // what changes them; a comment changes nothing.
    [Theory]
    [InlineData("M61 Q2", true)]
    [InlineData("M6 T3", true)]
    [InlineData("T4", true)]
    [InlineData("G55", true)]
    [InlineData("G90 G94 G56", true)]
    [InlineData("M30", true)]
    [InlineData("M2", true)]
    [InlineData("G54.1 P2", false)]
    [InlineData("M600", false)]
    [InlineData("M62 P1", false)]
    [InlineData("(UNLOAD CURRENT TOOL T1)", false)]
    [InlineData("G0 X1 ; to T2", false)]
    [InlineData("G1 X5 F500", false)]
    public void FluidNc_reads_the_parser_state_back_after_tool_and_workspace_changes(string line, bool refresh) =>
        Assert.Equal(refresh, ((IProtocolHandler)new FluidNcProtocol()).NeedsGCodeStateRefresh(line));

    // grblHAL is what everything is written for: lines go out as they are.
    public static IEnumerable<object[]> Existing() =>
        [[new GrblHalProtocol()]];

    [Theory]
    [MemberData(nameof(Existing))]
    public void Existing_protocols_have_no_translator(IProtocolHandler p)
    {
        Assert.Null(p.CreateTranslator(() => new MachineState()));
        Assert.Null(p.StaticAlarmDescriptions);
        Assert.Null(p.StaticSettingDefinitions);
        Assert.Null(p.RedirectProtocol("[NEWOPT:ENUMS]"));
    }

    [Fact]
    public void Grbl_translates_and_lists_its_own_alarms()
    {
        IProtocolHandler p = new GrblProtocol { ToolFile = null };
        Assert.NotNull(p.CreateTranslator(() => new MachineState()));
        Assert.Equal(9, p.StaticAlarmDescriptions!.Count);
        Assert.False(p.SupportsOverrideControl);
        Assert.Equal("grblhal", p.RedirectProtocol("[NEWOPT:ENUMS]"));
        Assert.Null(p.RedirectProtocol("[OPT:V,15,128]"));
    }

    // Only FluidNC keeps a config.yaml for the Config tab; Grbl can't list
    // its settings either, but gets the Firmware tab from its fixed list.
    [Fact]
    public void Only_FluidNc_has_a_config_file()
    {
        Assert.True(((IProtocolHandler)new FluidNcProtocol()).SupportsConfigFile);
        Assert.False(((IProtocolHandler)new GrblProtocol { ToolFile = null }).SupportsConfigFile);
        Assert.False(((IProtocolHandler)new GrblHalProtocol()).SupportsConfigFile);
    }

    [Fact]
    public void Grbl_describes_its_settings()
    {
        var defs = ((IProtocolHandler)new GrblProtocol { ToolFile = null }).StaticSettingDefinitions!;
        Assert.Equal("Homing cycle enable", defs[22].Name);
        Assert.Equal(0, defs[22].DataType);
        Assert.Equal("X,Y,Z", defs[23].Format);
        Assert.Equal("step/mm", defs[100].Unit);
        Assert.Equal("Z-axis maximum travel", defs[132].Name);
        Assert.All(defs.Values, d => Assert.NotNull(d.Group));
        // Every setting carries a description where the Firmware tab reads it.
        Assert.All(defs.Values, d => Assert.False(string.IsNullOrWhiteSpace(d.HalDetails?[4])));
    }
}
