using System.Text.Json;
using System.Text.Json.Nodes;
using NcSender.Server.Pendant;
using NcSender.Server.Probing;
using NcSender.Server.Probing.Strategies;
using Xunit;

namespace NcSender.Server.Tests;

public class ToolLengthSetterProbeTests
{
    private static Dictionary<string, JsonElement> Options(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

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

    [Fact]
    public void ZRoutine_Defaults_AreTheStandardBlockCycle()
    {
        var routine = StandardBlockStrategy.GetZProbeRoutine();

        Assert.Contains("G38.2 Z-30 F200", routine);
        Assert.Contains("G0 Z4", routine);
        Assert.Contains("G4 P0.1", routine);
        Assert.Contains("G38.2 Z-5 F75", routine);
    }

    [Fact]
    public void ZRoutine_UsesCustomRetractDelayAndFeedrates()
    {
        var routine = StandardBlockStrategy.GetZProbeRoutine(
            zThickness: 40.9, secondProbeDelay: 0.5, retractDistance: 2,
            firstProbeFeedrate: 300, secondProbeFeedrate: 40);

        Assert.Contains("G38.2 Z-30 F300", routine);
        Assert.Contains("G0 Z2", routine);
        Assert.Contains("G4 P0.5", routine);
        Assert.Contains("G38.2 Z-3 F40", routine);
        Assert.Contains("G10 L20 Z40.9", routine);
    }

    [Fact]
    public void StandardBlockZ_IgnoresToolLengthSetterOptions()
    {
        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(Options("""
            { "probeType": "standard-block", "probingAxis": "Z", "zThickness": 15,
              "secondProbeDelay": 2, "retractDistance": 9, "firstProbeFeedrate": 900, "secondProbeFeedrate": 10 }
            """));

        Assert.Empty(errors);
        Assert.Equal(StandardBlockStrategy.GetZProbeRoutine(15), commands);
    }

    [Fact]
    public void ToolLengthSetter_UsesItsOptions()
    {
        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(Options("""
            { "probeType": "tool-length-setter", "probingAxis": "Z", "zThickness": 40.9,
              "secondProbeDelay": 1.2, "retractDistance": 3, "firstProbeFeedrate": 400, "secondProbeFeedrate": 50 }
            """));

        Assert.Empty(errors);
        Assert.Contains("G38.2 Z-30 F400", commands);
        Assert.Contains("G0 Z3", commands);
        Assert.Contains("G4 P1.2", commands);
        Assert.Contains("G38.2 Z-4 F50", commands);
    }

    [Fact]
    public void ToolLengthSetter_WithoutOptions_WaitsHalfASecond()
    {
        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(Options("""
            { "probeType": "tool-length-setter", "probingAxis": "Z", "zThickness": 40.9 }
            """));

        Assert.Empty(errors);
        Assert.Contains("G4 P0.5", commands);
        Assert.Contains("G0 Z4", commands);
        Assert.Contains("G38.2 Z-30 F200", commands);
        Assert.Contains("G38.2 Z-5 F75", commands);
    }

    [Fact]
    public void ToolLengthSetter_ClampsOutOfRangeValues()
    {
        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(Options("""
            { "probeType": "tool-length-setter", "probingAxis": "Z", "zThickness": 40.9,
              "secondProbeDelay": 60, "retractDistance": 0, "firstProbeFeedrate": 99999, "secondProbeFeedrate": 0 }
            """));

        Assert.Empty(errors);
        Assert.Contains("G4 P5", commands);
        Assert.Contains("G0 Z0.1", commands);
        Assert.Contains("G38.2 Z-30 F5000", commands);
        Assert.Contains("G38.2 Z-1.1 F1", commands);
    }

    [Fact]
    public void PendantToolLengthSetter_UsesTheSavedSettings()
    {
        var opts = PendantProbeOptions.Build("tool-length-setter", "Z", null, null, Reader("""
            { "probe": { "tool-length-setter": { "zThickness": 40.9, "retractDistance": 3,
              "secondProbeDelay": 1, "firstProbeFeedrate": 250, "secondProbeFeedrate": 60 } } }
            """));

        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(opts);

        Assert.Empty(errors);
        Assert.Contains("G38.2 Z-30 F250", commands);
        Assert.Contains("G0 Z3", commands);
        Assert.Contains("G4 P1", commands);
        Assert.Contains("G38.2 Z-4 F60", commands);
        Assert.Contains("G10 L20 Z40.9", commands);
    }
}
