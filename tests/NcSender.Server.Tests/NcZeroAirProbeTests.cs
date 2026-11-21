using System.Text.Json;
using NcSender.Server.Probing;

namespace NcSender.Server.Tests;

// ncZeroAir Probe: 60 x 60 x 29 block, 30 mm hole 20 mm deep. Top face 25 mm
// above the material, outer sides 10 mm outside its edges, so the hole's centre
// is 20 mm in from the corner and its floor 5 mm above the material.
public class NcZeroAirProbeTests
{
    private static List<string> Generate(string axis, string mode, string corner = "BottomLeft", string? side = null)
    {
        var json = $$"""
            {"probeType":"nczeroair","probingAxis":"{{axis}}","ncZeroAirMode":"{{mode}}",
             "selectedCorner":"{{corner}}","selectedSide":"{{side}}","standardBlockBitDiameter":6}
            """;
        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(
            JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!);
        Assert.Empty(errors);
        return commands;
    }

    [Fact]
    public void Z_InTheHole_ZeroesOnItsFloor_AndLiftsOutAboveTheTop()
    {
        var code = Generate("Z", "hole");
        var set = code.IndexOf("G10 L20 Z5");
        Assert.True(set > 0);
        Assert.Equal("G90", code[set + 1]);
        Assert.Equal("G0 Z28", code[set + 2]);
    }

    [Fact]
    public void Z_OnTheTop_ZeroesTwentyFiveUp_AndParksThreeAbove()
    {
        var code = Generate("Z", "edge");
        var set = code.IndexOf("G10 L20 Z25");
        Assert.True(set > 0);
        Assert.Equal("G0 Z3", code[set + 1]);
    }

    [Theory]
    [InlineData("BottomLeft", "G10 L20 X20 Y20")]
    [InlineData("BottomRight", "G10 L20 X-20 Y20")]
    [InlineData("TopLeft", "G10 L20 X20 Y-20")]
    [InlineData("TopRight", "G10 L20 X-20 Y-20")]
    public void HoleXY_PutsTheCornerTwentyFromTheCentre(string corner, string expected)
    {
        var code = Generate("XY", "hole", corner);
        Assert.Contains(expected, code);
        // Both walls on both axes, and the tool stops halfway between each pair.
        Assert.Contains("G0 X[[#<X1>-#<X2>]/2]", code);
        Assert.Contains("G0 Y[[#<Y1>-#<Y2>]/2]", code);
        // Z is unknown: no move out of the hole.
        Assert.DoesNotContain(code, l => l.Contains("X0 Y0"));
    }

    [Fact]
    public void HoleXYZ_ZeroesOnTheFloor_AndEndsAboveTheBlockWithoutPlunging()
    {
        var code = Generate("XYZ", "hole");
        Assert.Contains("G10 L20 Z5", code);
        Assert.Contains("G10 L20 X20 Y20", code);
        var lift = code.IndexOf("G0 Z28");
        Assert.True(lift > 0);
        Assert.Equal("G90", code[lift - 1]);
        Assert.Equal("G0 X0 Y0", code[lift + 1]);
        // Nothing goes down after the move to the corner.
        Assert.DoesNotContain(code.Skip(lift + 1), l => l.Contains('Z'));
    }

    [Fact]
    public void HoleX_SetsOnlyThatAxis()
    {
        var code = Generate("X", "hole", side: "Right");
        Assert.Contains("G10 L20 X-20", code);
        Assert.DoesNotContain(code, l => l.Contains("#<Y1>"));
    }

    [Fact]
    public void Edge_IsAStandardBlockWithThisBlocksSizes()
    {
        var xyz = Generate("XYZ", "edge");
        Assert.Contains("G10 L20 Z25", xyz);
        // 10 mm side plus half the 6 mm bit.
        Assert.Contains("G10 L20 X-13", xyz);
        Assert.Contains("G10 L20 Y-13", xyz);
    }
}
