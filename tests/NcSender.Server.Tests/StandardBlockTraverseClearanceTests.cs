using NcSender.Server.Probing.Strategies;
using Xunit;

namespace NcSender.Server.Tests;

/// <summary>
/// Reported from the shop: Standard Block, XYZ, Z probe distance raised to 15mm.
/// The cycle probed correctly and then drove the tool through the block on its
/// way to X0 Y0.
///
/// The final lift was a flat "G0 Z10" in relative mode. In an XYZ cycle the tool
/// is zProbeDistance BELOW the top of the block when it reaches that line — the
/// Z probe parks 4mm above, then it drops by (zProbeDistance + 4) to reach the
/// sides — so the clearance actually left is 10 - zProbeDistance. Positive at
/// the 3mm default, which is why this went unnoticed; -5mm at 15mm.
/// </summary>
public class StandardBlockTraverseClearanceTests
{
    // The routine parks 4mm above the block after probing Z, then descends by
    // (zProbeDistance + 4) to reach the sides. Net: zProbeDistance below the top.
    private const double ParkAboveBlock = 4;

    private static double FinalLift(List<string> code)
    {
        // The lift immediately before the traverse to the corner.
        var idx = code.FindIndex(l => l.StartsWith("G90 G0 X0 Y0"));
        Assert.True(idx > 0, "routine must end by traversing to the corner");
        var lift = code[idx - 1];
        Assert.StartsWith("G0 Z", lift);
        return double.Parse(lift["G0 Z".Length..], System.Globalization.CultureInfo.InvariantCulture);
    }

    private static double DepthBelowBlockTop(double zProbeDistance) =>
        (zProbeDistance + ParkAboveBlock) - ParkAboveBlock;

    [Theory]
    [InlineData(3)]    // default
    [InlineData(10)]
    [InlineData(15)]   // the reported case
    [InlineData(25)]
    public void XyzCycle_ClearsTheBlockBeforeTraversing(double zProbeDistance)
    {
        var code = StandardBlockStrategy.GetXYZProbeRoutine(
            "BottomLeft", xyThickness: 10, zThickness: 15,
            zProbeDistance: zProbeDistance, bitDiameter: 6.35);

        var clearance = FinalLift(code) - DepthBelowBlockTop(zProbeDistance);

        // Above the block, not merely level with it — a traverse at exactly zero
        // still drags across the top face.
        Assert.True(clearance > 0,
            $"tool ends {clearance}mm relative to the block top at zProbeDistance={zProbeDistance}");
    }

    [Fact]
    public void OrdinaryCycle_LiftIsUnchanged()
    {
        // The old behaviour was a flat 10mm and it was fine for normal values.
        // Deriving the lift must not quietly reduce it.
        var code = StandardBlockStrategy.GetXYZProbeRoutine(
            "BottomLeft", xyThickness: 10, zThickness: 15,
            zProbeDistance: 3, bitDiameter: 6.35);

        Assert.Equal(10, FinalLift(code));
    }

    [Fact]
    public void StandaloneXy_IsNotAffected()
    {
        // Nothing lowered the tool in an XY-only cycle, so it keeps the old lift.
        var code = StandardBlockStrategy.GetXYProbeRoutine(
            "BottomLeft", xyThickness: 10, bitDiameter: 6.35);

        Assert.Equal(10, FinalLift(code));
    }
}
