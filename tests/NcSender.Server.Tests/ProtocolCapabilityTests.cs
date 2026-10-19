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
}
