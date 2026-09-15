using System.Globalization;
using System.Text.Json.Nodes;
using NcSender.Server.Pendant;
using NcSender.Server.Probing;
using Xunit;

namespace NcSender.Server.Tests;

public class PendantProbeOptionsTests
{
    private const string SavedByDialog = """
        {
          "probe": {
            "3d-probe": { "ballPointDiameter": 3, "zPlunge": 5, "zOffset": -0.2,
                          "xDimension": 50, "yDimension": 60, "rapidMovement": 1500, "probeZFirst": true },
            "standard-block": { "zThickness": 20, "xyThickness": 12, "zProbeDistance": 6,
                                "edgeDistance": 40, "selectedBitDiameter": "3.175" },
            "tool-length-setter": { "zThickness": 40.9 },
            "autozero-touch": { "rapidMovement": 1800 }
          }
        }
        """;

    private static Func<string, JsonNode?> Reader(string json)
    {
        var root = JsonNode.Parse(json);
        return key =>
        {
            JsonNode? node = root;
            foreach (var part in key.Split('.'))
            {
                node = (node as JsonObject)?[part];
                if (node is null) return null;
            }
            return node;
        };
    }

    private static double Num(Dictionary<string, System.Text.Json.JsonElement> opts, string key) =>
        opts[key].GetDouble();

    [Fact]
    public void StandardBlock_UsesTheBlockSettingsSavedByTheDialog()
    {
        var opts = PendantProbeOptions.Build("standard-block", "XYZ", "BottomLeft", null, Reader(SavedByDialog));

        Assert.Equal(20, Num(opts, "zThickness"));
        Assert.Equal(12, Num(opts, "xyThickness"));
        Assert.Equal(6, Num(opts, "zProbeDistance"));
        Assert.Equal(40, Num(opts, "edgeDistance"));
        Assert.Equal(3.175, Num(opts, "standardBlockBitDiameter"), 3);
    }

    [Fact]
    public void ThreeDProbe_UsesTheProbeSettingsSavedByTheDialog()
    {
        var opts = PendantProbeOptions.Build("3d-probe", "XYZ", "BottomLeft", null, Reader(SavedByDialog));

        Assert.Equal(3, Num(opts, "toolDiameter"));
        Assert.Equal(5, Num(opts, "zPlunge"));
        Assert.Equal(-0.2, Num(opts, "zOffset"), 3);
        Assert.Equal(50, Num(opts, "xDimension"));
        Assert.Equal(60, Num(opts, "yDimension"));
        Assert.Equal(1500, Num(opts, "rapidMovement"));
        Assert.True(opts["probeZFirst"].GetBoolean());
    }

    [Fact]
    public void ToolLengthSetter_UsesItsOwnThickness()
    {
        var opts = PendantProbeOptions.Build("tool-length-setter", "Z", null, null, Reader(SavedByDialog));

        Assert.Equal(40.9, Num(opts, "zThickness"), 3);
    }

    [Fact]
    public void AutoZero_UsesItsOwnRapidAndMeasuresTheBit()
    {
        var opts = PendantProbeOptions.Build("autozero-touch", "XYZ", "BottomLeft", null, Reader(SavedByDialog));

        Assert.Equal(1800, Num(opts, "rapidMovement"));
        Assert.Equal("Auto", opts["selectedBitDiameter"].GetString());
    }

    [Fact]
    public void NothingSaved_FallsBackToTheDialogDefaults()
    {
        var opts = PendantProbeOptions.Build("standard-block", "XYZ", "BottomLeft", null, Reader("{}"));

        Assert.Equal(15, Num(opts, "zThickness"));
        Assert.Equal(10, Num(opts, "xyThickness"));
        Assert.Equal(3, Num(opts, "zProbeDistance"));
        Assert.Equal(10, Num(opts, "edgeDistance"));
        Assert.Equal(6.35, Num(opts, "standardBlockBitDiameter"), 3);
        Assert.Equal(2000, Num(opts, "rapidMovement"));
        Assert.False(opts["probeZFirst"].GetBoolean());
    }

    [Fact]
    public void EdgeDistanceNotSaved_FollowsTheSavedXyThickness()
    {
        var opts = PendantProbeOptions.Build("standard-block", "XYZ", "BottomLeft", null,
            Reader("""{ "probe": { "standard-block": { "xyThickness": 12 } } }"""));

        Assert.Equal(12, Num(opts, "edgeDistance"));
    }

    [Fact]
    public void Placement_IsASideForXAndY_AndACornerOtherwise()
    {
        var side = PendantProbeOptions.Build("standard-block", "X", "Left", null, Reader("{}"));
        Assert.Equal("Left", side["selectedSide"].GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, side["selectedCorner"].ValueKind);

        var corner = PendantProbeOptions.Build("standard-block", "XY", "TopRight", null, Reader("{}"));
        Assert.Equal("TopRight", corner["selectedCorner"].GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, corner["selectedSide"].ValueKind);
    }

    [Fact]
    public void CentreDiameter_OverridesBothDimensions()
    {
        var opts = PendantProbeOptions.Build("3d-probe", "Center - Inner", null, 25, Reader(SavedByDialog));

        Assert.Equal(25, Num(opts, "xDimension"));
        Assert.Equal(25, Num(opts, "yDimension"));
    }

    [Fact]
    public void PendantXyz_GeneratesTheRoutineForTheSavedBlock()
    {
        var opts = PendantProbeOptions.Build("standard-block", "XYZ", "BottomLeft", null, Reader(SavedByDialog));

        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(opts);

        Assert.Empty(errors);
        var outward = commands.First(l => l.StartsWith("G0 X"));
        Assert.Equal(-(40 + 3.175 + 5), double.Parse(outward["G0 X".Length..], CultureInfo.InvariantCulture), 3);
        Assert.Contains(commands, l => l == "G10 L20 Z20");
    }
}
