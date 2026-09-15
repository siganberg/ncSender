using System.Globalization;
using NcSender.Server.Probing.Strategies;
using Xunit;

namespace NcSender.Server.Tests;

public class StandardBlockEdgeDistanceTests
{
    private static double Value(string line, string prefix) =>
        double.Parse(line[prefix.Length..], CultureInfo.InvariantCulture);

    private static double OutwardXMove(List<string> code) =>
        Value(code.First(l => l.StartsWith("G0 X")), "G0 X");

    private static (double yOut, double xBack) SideMoves(List<string> code)
    {
        var yIdx = code.FindIndex(l => l.StartsWith("G0 Y"));
        var xIdx = code.FindIndex(yIdx, l => l.StartsWith("G0 X"));
        return (Value(code[yIdx], "G0 Y"), Value(code[xIdx], "G0 X"));
    }

    [Fact]
    public void Xyz_WithoutEdgeDistance_UsesXyThickness()
    {
        var code = StandardBlockStrategy.GetXYZProbeRoutine(
            "BottomLeft", xyThickness: 10, zThickness: 15, zProbeDistance: 3, bitDiameter: 6.35);

        Assert.Equal(-21.35, OutwardXMove(code), 3);
    }

    [Fact]
    public void Xyz_EdgeDistanceEqualToXyThickness_IsUnchanged()
    {
        var before = StandardBlockStrategy.GetXYZProbeRoutine(
            "BottomLeft", xyThickness: 10, zThickness: 15, zProbeDistance: 3, bitDiameter: 6.35);
        var after = StandardBlockStrategy.GetXYZProbeRoutine(
            "BottomLeft", xyThickness: 10, zThickness: 15, zProbeDistance: 3, bitDiameter: 6.35,
            edgeDistance: 10);

        Assert.Equal(before, after);
    }

    [Theory]
    [InlineData("BottomLeft", -1, 1)]
    [InlineData("BottomRight", 1, 1)]
    [InlineData("TopLeft", -1, -1)]
    [InlineData("TopRight", 1, -1)]
    public void Xyz_LargerEdgeDistance_ClearsTheBlockOnBothSides(string corner, int xSign, int ySign)
    {
        var code = StandardBlockStrategy.GetXYZProbeRoutine(
            corner, xyThickness: 10, zThickness: 15, zProbeDistance: 3, bitDiameter: 6.35,
            edgeDistance: 40);

        var reach = 40 + 6.35 + 5;
        Assert.Equal(xSign * reach, OutwardXMove(code), 3);

        var (yOut, xBack) = SideMoves(code);
        Assert.Equal(-ySign * (reach + 4), yOut, 3);
        Assert.Equal(-xSign * (reach + 4), xBack, 3);
    }

    [Fact]
    public void StandaloneXy_IgnoresEdgeDistance()
    {
        var code = StandardBlockStrategy.GetXYProbeRoutine(
            "BottomLeft", xyThickness: 10, bitDiameter: 6.35);

        Assert.Contains(code, l => l.StartsWith("G0 Y") && Math.Abs(Value(l, "G0 Y") - 21.35) < 0.001);
    }
}
