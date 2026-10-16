using NcSender.Core.Models;
using NcSender.Server.Pendant;

namespace NcSender.Server.Tests;

// The pendant switches an aux output off with the command derived from its
// "on" command. A Wireless I/O output had none, so it could be switched on
// from the pendant but never off.
public class PendantAuxOffTests
{
    [Theory]
    [InlineData("M8", "M9")]
    [InlineData("M7", "M9")]
    [InlineData("M64 P2", "M65 P2")]
    [InlineData("(DONGLE:xio:out 0 1)", "(DONGLE:xio:out 0 0)")]
    [InlineData("(DONGLE:xio:out 3 1)", "(DONGLE:xio:out 3 0)")]
    public void Off_command_follows_the_on_command(string on, string off)
    {
        Assert.Equal(off, PendantManager.DeriveOffFromOn(on));
    }

    [Theory]
    [InlineData("")]
    [InlineData("(DONGLE:xio:out 0 0)")]
    [InlineData("G4 P1")]
    public void Anything_else_has_no_off_command(string on)
    {
        Assert.Equal("", PendantManager.DeriveOffFromOn(on));
    }

    // The pendant picks on or off from the state it is sent. A Wireless I/O
    // output always read as off, so every press sent "on" again.
    [Theory]
    [InlineData("status in=00 out=1 out0=1 out1=0 out2=0 out3=0 dr=1 seq=5", true)]
    [InlineData("status in=00 out=0 out0=0 out1=0 out2=0 out3=0 dr=1 seq=6", false)]
    [InlineData(null, false)]
    public void A_bridge_output_reads_its_state_from_the_bridge(string? status, bool on)
    {
        Assert.Equal(on, PendantManager.IsAuxOn("(DONGLE:xio:out 0 1)", new MachineState(), status));
    }

    [Fact]
    public void Each_bridge_output_reads_its_own_field()
    {
        const string status = "status out=4 out0=0 out1=0 out2=1 out3=0 seq=9";
        Assert.False(PendantManager.IsAuxOn("(DONGLE:xio:out 0 1)", new MachineState(), status));
        Assert.True(PendantManager.IsAuxOn("(DONGLE:xio:out 2 1)", new MachineState(), status));
    }
}
