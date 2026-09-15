using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NcSender.Server.Pendant;

internal static class PendantProbeOptions
{
    public static Dictionary<string, JsonElement> Build(
        string probeType, string axis, string? placement, double? centerDiameter,
        Func<string, JsonNode?> read)
    {
        var isSide = axis is "X" or "Y";

        double Number(string key, double fallback) => ReadNumber(read(key)) ?? fallback;
        bool Flag(string key, bool fallback) =>
            read(key) is JsonValue value && value.TryGetValue<bool>(out var b) ? b : fallback;

        var xyThickness = Number("probe.standard-block.xyThickness", 10);
        var zThicknessKey = probeType == "tool-length-setter"
            ? "probe.tool-length-setter.zThickness"
            : "probe.standard-block.zThickness";

        return new Dictionary<string, JsonElement>
        {
            ["probeType"]      = Str(probeType),
            ["probingAxis"]    = Str(axis),
            ["selectedCorner"] = Str(isSide ? null : placement),
            ["selectedSide"]   = Str(isSide ? placement : null),

            ["toolDiameter"]   = Num(Number("probe.3d-probe.ballPointDiameter", 2)),
            ["zPlunge"]        = Num(Number("probe.3d-probe.zPlunge", 3)),
            ["zOffset"]        = Num(Number("probe.3d-probe.zOffset", -0.1)),
            ["xDimension"]     = Num(centerDiameter ?? Number("probe.3d-probe.xDimension", 100)),
            ["yDimension"]     = Num(centerDiameter ?? Number("probe.3d-probe.yDimension", 100)),
            ["probeZFirst"]    = Bool(Flag("probe.3d-probe.probeZFirst", false)),
            ["rapidMovement"]  = Num(Number($"probe.{probeType}.rapidMovement", 2000)),

            ["zThickness"]     = Num(Number(zThicknessKey, 15)),
            ["xyThickness"]    = Num(xyThickness),
            ["zProbeDistance"] = Num(Number("probe.standard-block.zProbeDistance", 3)),
            ["edgeDistance"]   = Num(Number("probe.standard-block.edgeDistance", xyThickness)),
            ["standardBlockBitDiameter"] = Num(Number("probe.standard-block.selectedBitDiameter", 6.35)),

            ["selectedBitDiameter"] = Str("Auto"),
        };
    }

    private static double? ReadNumber(JsonNode? node)
    {
        if (node is not JsonValue value) return null;
        if (value.TryGetValue<double>(out var d)) return d;
        if (value.TryGetValue<int>(out var i)) return i;
        if (value.TryGetValue<long>(out var l)) return l;
        if (value.TryGetValue<string>(out var s)
            && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
            return parsed;
        return null;
    }

    private static JsonElement Str(string? v)
    {
        if (v is null) return JsonDocument.Parse("null").RootElement.Clone();
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms)) w.WriteStringValue(v);
        using var doc = JsonDocument.Parse(ms.ToArray());
        return doc.RootElement.Clone();
    }

    private static JsonElement Num(double v)
    {
        using var doc = JsonDocument.Parse(v.ToString(CultureInfo.InvariantCulture));
        return doc.RootElement.Clone();
    }

    private static JsonElement Bool(bool v)
    {
        using var doc = JsonDocument.Parse(v ? "true" : "false");
        return doc.RootElement.Clone();
    }
}
