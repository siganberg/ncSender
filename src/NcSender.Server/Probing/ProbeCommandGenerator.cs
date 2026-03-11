using System.Globalization;
using System.Text.Json;
using NcSender.Server.Probing.Strategies;

namespace NcSender.Server.Probing;

public static class ProbeCommandGenerator
{
    private static readonly HashSet<string> CornerValues = ["TopRight", "TopLeft", "BottomRight", "BottomLeft"];
    private static readonly HashSet<string> XSideValues = ["Left", "Right"];
    private static readonly HashSet<string> YSideValues = ["Front", "Back"];
    private static readonly HashSet<string> BitDiameterSpecial = ["Auto", "Tip"];

    public static (List<string> Commands, List<string> Errors) GenerateCommands(
        Dictionary<string, JsonElement>? options)
    {
        var errors = new List<string>();

        if (options is null or { Count: 0 })
        {
            errors.Add("No probe options provided");
            return ([], errors);
        }

        var probeType = GetString(options, "probeType")?.Trim() ?? "";
        var probingAxis = GetString(options, "probingAxis")?.Trim() ?? "";

        if (string.IsNullOrEmpty(probeType))
        {
            errors.Add("Invalid probe type");
            return ([], errors);
        }

        if (string.IsNullOrEmpty(probingAxis))
        {
            errors.Add("Invalid probing axis for selected probe type");
            return ([], errors);
        }

        // Map standardBlockBitDiameter to bitDiameter for Standard Block
        if (probeType == "standard-block" && options.ContainsKey("standardBlockBitDiameter"))
            options["bitDiameter"] = options["standardBlockBitDiameter"];

        var commands = probeType switch
        {
            "3d-probe" => Generate3DProbe(probingAxis, options, errors),
            "standard-block" => GenerateStandardBlock(probingAxis, options, errors),
            "autozero-touch" => GenerateAutoZeroTouch(probingAxis, options, errors),
            _ => null
        };

        if (commands is null && errors.Count == 0)
            errors.Add("Invalid probe type");

        return (commands ?? [], errors);
    }

    private static List<string>? Generate3DProbe(
        string axis, Dictionary<string, JsonElement> opts, List<string> errors)
    {
        return axis switch
        {
            "Z" => ThreeDProbeStrategy.GetZProbeRoutine(
                GetDouble(opts, "zOffset", 0)),

            "X" => RequireXSide(opts, errors, side =>
                ThreeDProbeStrategy.GetXProbeRoutine(side,
                    GetDouble(opts, "toolDiameter", 6))),

            "Y" => RequireYSide(opts, errors, side =>
                ThreeDProbeStrategy.GetYProbeRoutine(side,
                    GetDouble(opts, "toolDiameter", 6))),

            "XY" => RequireCorner(opts, errors, corner =>
                ThreeDProbeStrategy.GetXYProbeRoutine(corner,
                    GetDouble(opts, "toolDiameter", 6))),

            "XYZ" => RequireCorner(opts, errors, corner =>
                ThreeDProbeStrategy.GetXYZProbeRoutine(corner,
                    GetDouble(opts, "toolDiameter", 6),
                    GetDouble(opts, "zPlunge", 3),
                    GetDouble(opts, "zOffset", 0))),

            "Center - Inner" => ThreeDProbeStrategy.GetCenterInnerRoutine(
                GetDouble(opts, "xDimension", 0),
                GetDouble(opts, "yDimension", 0),
                GetDouble(opts, "toolDiameter", 2),
                GetDouble(opts, "rapidMovement", 2000),
                GetDouble(opts, "zPlunge", 3)),

            "Center - Outer" => ThreeDProbeStrategy.GetCenterOuterRoutine(
                GetDouble(opts, "xDimension", 0),
                GetDouble(opts, "yDimension", 0),
                GetDouble(opts, "toolDiameter", 2),
                GetDouble(opts, "rapidMovement", 2000),
                GetBool(opts, "probeZFirst", false),
                GetDouble(opts, "zPlunge", 3),
                GetDouble(opts, "zOffset", 0)),

            _ => AddError(errors, "Invalid probing axis for 3D probe")
        };
    }

    private static List<string>? GenerateStandardBlock(
        string axis, Dictionary<string, JsonElement> opts, List<string> errors)
    {
        return axis switch
        {
            "Z" => StandardBlockStrategy.GetZProbeRoutine(
                GetDouble(opts, "zThickness", 15)),

            "X" => RequireXSide(opts, errors, side =>
                StandardBlockStrategy.GetXProbeRoutine(side,
                    GetDouble(opts, "xyThickness", 10),
                    GetDouble(opts, "bitDiameter", 6.35))),

            "Y" => RequireYSide(opts, errors, side =>
                StandardBlockStrategy.GetYProbeRoutine(side,
                    GetDouble(opts, "xyThickness", 10),
                    GetDouble(opts, "bitDiameter", 6.35))),

            "XY" => RequireCorner(opts, errors, corner =>
                StandardBlockStrategy.GetXYProbeRoutine(corner,
                    GetDouble(opts, "xyThickness", 10),
                    GetDouble(opts, "bitDiameter", 6.35))),

            "XYZ" => RequireCorner(opts, errors, corner =>
                StandardBlockStrategy.GetXYZProbeRoutine(corner,
                    GetDouble(opts, "xyThickness", 10),
                    GetDouble(opts, "zThickness", 15),
                    GetDouble(opts, "zProbeDistance", 3),
                    GetDouble(opts, "bitDiameter", 6.35))),

            _ => AddError(errors, "Invalid probing axis for standard block")
        };
    }

    private static List<string>? GenerateAutoZeroTouch(
        string axis, Dictionary<string, JsonElement> opts, List<string> errors)
    {
        var bitDiameter = GetString(opts, "selectedBitDiameter")?.Trim() ?? "Auto";
        if (!ValidateBitDiameter(bitDiameter))
        {
            errors.Add("Invalid bit diameter");
            return null;
        }

        return axis switch
        {
            "Z" => AutoZeroTouchStrategy.GetZProbeRoutine(bitDiameter),

            "X" => RequireXSide(opts, errors, side =>
                AutoZeroTouchStrategy.GetXProbeRoutine(side, bitDiameter,
                    GetDouble(opts, "rapidMovement", 2000))),

            "Y" => RequireYSide(opts, errors, side =>
                AutoZeroTouchStrategy.GetYProbeRoutine(side, bitDiameter,
                    GetDouble(opts, "rapidMovement", 2000))),

            "XY" => RequireCorner(opts, errors, corner =>
                AutoZeroTouchStrategy.GetXYProbeRoutine(corner, bitDiameter,
                    GetDouble(opts, "rapidMovement", 2000),
                    GetBool(opts, "returnToXYZero") || GetBool(opts, "moveToZero"))),

            "XYZ" => RequireCorner(opts, errors, corner =>
                AutoZeroTouchStrategy.GetXYZProbeRoutine(corner, bitDiameter,
                    GetDouble(opts, "rapidMovement", 2000))),

            _ => AddError(errors, "Invalid probing axis for AutoZero touch")
        };
    }

    private static List<string>? RequireCorner(
        Dictionary<string, JsonElement> opts, List<string> errors,
        Func<string, List<string>> generate)
    {
        var corner = GetString(opts, "selectedCorner")?.Trim()
                     ?? GetString(opts, "probeSelectedCorner")?.Trim()
                     ?? "";
        if (string.IsNullOrEmpty(corner) || !CornerValues.Contains(corner))
        {
            errors.Add("Missing required field: selectedCorner");
            return null;
        }
        return generate(corner);
    }

    private static List<string>? RequireXSide(
        Dictionary<string, JsonElement> opts, List<string> errors,
        Func<string, List<string>> generate)
    {
        var side = GetString(opts, "selectedSide")?.Trim()
                   ?? GetString(opts, "probeSelectedSide")?.Trim()
                   ?? "";
        if (string.IsNullOrEmpty(side) || !XSideValues.Contains(side))
        {
            errors.Add("Missing required field: selectedSide");
            return null;
        }
        return generate(side);
    }

    private static List<string>? RequireYSide(
        Dictionary<string, JsonElement> opts, List<string> errors,
        Func<string, List<string>> generate)
    {
        var side = GetString(opts, "selectedSide")?.Trim()
                   ?? GetString(opts, "probeSelectedSide")?.Trim()
                   ?? "";
        if (string.IsNullOrEmpty(side) || !YSideValues.Contains(side))
        {
            errors.Add("Missing required field: selectedSide");
            return null;
        }
        return generate(side);
    }

    private static bool ValidateBitDiameter(string value)
    {
        if (BitDiameterSpecial.Contains(value))
            return true;
        return double.TryParse(value, CultureInfo.InvariantCulture, out var n) && n > 0;
    }

    private static List<string>? AddError(List<string> errors, string message)
    {
        errors.Add(message);
        return null;
    }

    private static string? GetString(Dictionary<string, JsonElement> opts, string key)
    {
        if (!opts.TryGetValue(key, out var el))
            return null;
        return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
    }

    private static double GetDouble(Dictionary<string, JsonElement> opts, string key, double defaultValue = 0)
    {
        if (!opts.TryGetValue(key, out var el))
            return defaultValue;

        if (el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var d))
            return d;

        if (el.ValueKind == JsonValueKind.String &&
            double.TryParse(el.GetString(), CultureInfo.InvariantCulture, out var parsed))
            return parsed;

        return defaultValue;
    }

    private static bool GetBool(Dictionary<string, JsonElement> opts, string key, bool defaultValue = false)
    {
        if (!opts.TryGetValue(key, out var el))
            return defaultValue;

        if (el.ValueKind is JsonValueKind.True)
            return true;
        if (el.ValueKind is JsonValueKind.False)
            return false;

        if (el.ValueKind == JsonValueKind.String)
        {
            var s = el.GetString()?.Trim().ToLowerInvariant();
            return s is "true" or "1" or "yes" or "on";
        }

        return defaultValue;
    }
}
