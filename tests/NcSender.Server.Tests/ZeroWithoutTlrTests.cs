using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

/// <summary>
/// Setting Z0 before a Tool Length Reference exists is remembered, so the next
/// tool setter run can keep that Z0 instead of shifting it by the tool length.
/// These lock in which lines count as "setting a Z work offset".
/// </summary>
public class ZeroWithoutTlrTests
{
    [Theory]
    [InlineData("G10 L20 P0 Z0")]
    [InlineData("G10L20P0Z0")]
    [InlineData("g10 l20 p0 z12.5")]
    [InlineData("G10 L20 P0 X0Y0Z0")]
    [InlineData("G10 L2 P1 Z-30.5")]
    [InlineData("G10 L2 P[#5220] Z[#<_cur_wcs_z_ofs> - #<_nc_ref_tlo>]")]
    [InlineData("G92 Z0")]
    public void ZWorkOffsetWrites_AreDetected(string line) =>
        Assert.True(CncController.WritesZWorkOffset(line));

    [Theory]
    [InlineData("G10 L20 P0 X0 Y0")]
    [InlineData("G10 L20 P0 X0 Y0 (Z is next)")]
    [InlineData("G10 L1 P1 Z5")]
    [InlineData("G92.1")]
    [InlineData("G92 X0")]
    [InlineData("G53 G0 Z0")]
    [InlineData("G43.1 Z0")]
    [InlineData("G38.2 Z-50 F100")]
    [InlineData("")]
    public void OtherLines_AreNotZWorkOffsetWrites(string line) =>
        Assert.False(CncController.WritesZWorkOffset(line));

    [Fact]
    public void A_Z0_set_with_a_tool_loaded_is_kept_for_that_tool()
    {
        var s = new MachineState { Tool = 3 };
        Assert.True(CncController.NoteZeroWithoutTlr(s));
        Assert.True(s.ZeroSetWithoutTlr);
        Assert.Equal(3, s.ZeroTool);
        Assert.False(CncController.NoteZeroWithoutTlr(s));   // same tool again: no change
    }

    [Fact]
    public void A_Z0_set_with_no_tool_loaded_is_not_kept()
    {
        // Kept, the tool changer would first measure "T0": the empty spindle.
        var s = new MachineState { Tool = 0 };
        Assert.False(CncController.NoteZeroWithoutTlr(s));
        Assert.False(s.ZeroSetWithoutTlr);
    }

    [Fact]
    public void A_Z0_set_with_no_tool_loaded_replaces_an_earlier_one()
    {
        var s = new MachineState { Tool = 3 };
        CncController.NoteZeroWithoutTlr(s);
        s.Tool = 0;
        Assert.True(CncController.NoteZeroWithoutTlr(s));
        Assert.False(s.ZeroSetWithoutTlr);
        Assert.Equal(0, s.ZeroTool);
    }
}
