using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Probing;
using NcSender.Server.Protocols.Grbl;

namespace NcSender.Server.Tests;

// Every probing routine ncSender generates is written for grblHAL (units saved
// in #<return_units>, centers worked out from #5061…, AutoZero's o100 if). On
// classic Grbl each one must translate line by line into plain G-code.
public class GrblProbeRoutineTests
{
    public static IEnumerable<object[]> Routines()
    {
        var corners = new[] { "TopRight", "TopLeft", "BottomRight", "BottomLeft" };
        foreach (var type in new[] { "3d-probe", "standard-block", "autozero-touch" })
        {
            yield return [type, "Z", null!];
            yield return [type, "X", "Left"];
            yield return [type, "X", "Right"];
            yield return [type, "Y", "Front"];
            yield return [type, "Y", "Back"];
            foreach (var c in corners)
            {
                yield return [type, "XY", c];
                yield return [type, "XYZ", c];
            }
        }
        yield return ["3d-probe", "Center - Inner", null!];
        yield return ["3d-probe", "Center - Outer", null!];
        yield return ["tool-length-setter", "Z", null!];
    }

    [Theory]
    [MemberData(nameof(Routines))]
    public void Routine_TranslatesToPlainGcode(string type, string axis, string? where)
    {
        var json = $$"""
            {"probeType":"{{type}}","probingAxis":"{{axis}}","selectedCorner":"{{where}}","selectedSide":"{{where}}",
             "xDimension":30,"yDimension":30,"selectedBitDiameter":"Auto"}
            """;
        var options = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;
        var (commands, errors) = ProbeCommandGenerator.GenerateCommands(options);
        Assert.Empty(errors);
        Assert.NotEmpty(commands);

        var state = new MachineState { G54 = "0,0,-50" };
        var t = new GrblTranslator(() => state);
        var sent = new List<string>();
        foreach (var command in commands)
        {
            foreach (var line in command.Split('\n'))
            {
                var r = t.Translate(line);
                for (var i = 0; r.Kind == TranslationKind.Sync && i < 3; i++) r = t.Translate(line);
                Assert.True(r.Kind == TranslationKind.Run, $"'{line}' → {r.Kind}: {r.Error}");
                foreach (var w in r.Steps.Select(s => s.Write).OfType<string>())
                {
                    sent.Add(w);
                    Assert.DoesNotContain('#', w);
                    Assert.DoesNotContain('[', w);
                    Assert.True(w.Length <= GrblTranslator.MaxLineLength, w);
                    // Every probe touches, a little further each time.
                    if (w.Contains("G38"))
                        t.ObserveData($"[PRB:{sent.Count},{sent.Count},-{sent.Count}:1]");
                }
            }
        }
        Assert.Contains(sent, w => w.Contains("G38"));
    }
}
