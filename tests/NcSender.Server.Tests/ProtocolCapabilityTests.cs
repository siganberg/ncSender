using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Protocols.FluidNc;
using NcSender.Server.Protocols.Grbl;
using NcSender.Server.Protocols.GrblHal;

namespace NcSender.Server.Tests;

// Tool changer plugins wrap a change in M51 (hold the spindle override at
// 100%) only when the controller understands it: FluidNC rejects M51, and a
// rejected line stops the tool change.
public class ProtocolCapabilityTests
{
    [Fact]
    public void GrblHal_supports_override_control() =>
        Assert.True(((IProtocolHandler)new GrblHalProtocol()).SupportsOverrideControl);

    [Fact]
    public void FluidNc_does_not_support_override_control() =>
        Assert.False(((IProtocolHandler)new FluidNcProtocol()).SupportsOverrideControl);

    // The Grbl members default to today's behaviour, so grblHAL and FluidNC
    // send every line exactly as before.
    public static IEnumerable<object[]> Existing() =>
        [[new GrblHalProtocol()], [new FluidNcProtocol()]];

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
        IProtocolHandler p = new GrblProtocol();
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
        Assert.False(((IProtocolHandler)new GrblProtocol()).SupportsConfigFile);
        Assert.False(((IProtocolHandler)new GrblHalProtocol()).SupportsConfigFile);
    }

    [Fact]
    public void Grbl_describes_its_settings()
    {
        var defs = ((IProtocolHandler)new GrblProtocol()).StaticSettingDefinitions!;
        Assert.Equal("Homing cycle enable", defs[22].Name);
        Assert.Equal(0, defs[22].DataType);
        Assert.Equal("X,Y,Z", defs[23].Format);
        Assert.Equal("step/mm", defs[100].Unit);
        Assert.Equal("Z-axis maximum travel", defs[132].Name);
        Assert.All(defs.Values, d => Assert.NotNull(d.Group));
    }
}
