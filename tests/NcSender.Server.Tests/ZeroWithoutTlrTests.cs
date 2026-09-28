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
}
