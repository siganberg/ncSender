using NcSender.Core.Interfaces;
using NcSender.Server.Protocols.FluidNc;
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
}
