using System.Globalization;

namespace NcSender.Server.Probing.Strategies;

public static class AutoZeroTouchStrategy
{
    private const double Bounce = 3;
    private const double PlateThickness = 5;
    private const double AutoPlateInnerDimension = 45;
    private const double AutoDiameterFallback = 6.35;
    private const double TipEffectiveDiameter = 0.5;
    private const double RapidProbeBounce = 2;
    private const string WaitCommand = "G4 P0.1";

    public record BitSpecification(
        string DisplayDiameter,
        bool IsAuto,
        bool IsTip,
        double EffectiveDiameter,
        double ToolRadius);

    public static BitSpecification ResolveBitSpecification(string selectedBitDiameter = "Auto")
    {
        var normalized = selectedBitDiameter.Trim();

        if (normalized == "Tip")
        {
            return new BitSpecification("Tip", IsAuto: true, IsTip: true,
                TipEffectiveDiameter, ToolRadius: 0);
        }

        if (normalized == "Auto")
        {
            return new BitSpecification("Auto", IsAuto: true, IsTip: false,
                AutoDiameterFallback, AutoDiameterFallback / 2);
        }

        if (double.TryParse(normalized, CultureInfo.InvariantCulture, out var parsed) && parsed > 0)
        {
            return new BitSpecification(parsed.ToString(CultureInfo.InvariantCulture),
                IsAuto: false, IsTip: false, parsed, parsed / 2);
        }

        // Fallback to Auto
        return new BitSpecification("Auto", IsAuto: true, IsTip: false,
            AutoDiameterFallback, AutoDiameterFallback / 2);
    }

    private static double ComputeSafeRapidDistance(double effectiveDiameter) =>
        AutoPlateInnerDimension / 2 - effectiveDiameter;

    public static List<string> BuildAxisProbeSequence(
        string axis, int directionSign, BitSpecification spec,
        double halfClearance, double safeRapidDistance, double rapidMovement)
    {
        var axisUpper = axis.ToUpperInvariant();
        var axisRegister = axisUpper == "X" ? "#5061" : "#5062";

        var code = new List<string>();

        if (!spec.IsTip)
        {
            code.Add($"G38.3 {axisUpper}{F(safeRapidDistance * directionSign)} F{F(rapidMovement)}");
            code.Add("#<probe_hit> = #5070");
            code.Add("O100 IF [#<probe_hit> EQ 1]");
            code.Add($"  G0 {axisUpper}{F(-RapidProbeBounce * directionSign)}");
            code.Add("O100 ENDIF");
        }

        code.Add($"G38.2 {axisUpper}{F(halfClearance * directionSign)} F150");
        code.Add($"G0 {axisUpper}{F(-Bounce * directionSign)}");
        code.Add($"G38.2 {axisUpper}{F((Bounce + 1) * directionSign)} F75");
        code.Add(WaitCommand);
        code.Add($"#<{axisUpper}1> = {axisRegister}");
        code.Add($"G0 {axisUpper}{F(-(halfClearance - spec.ToolRadius) * directionSign)}");

        if (spec.IsAuto)
        {
            if (!spec.IsTip)
            {
                code.Add($"G38.3 {axisUpper}{F(-safeRapidDistance * directionSign)} F{F(rapidMovement)}");
                code.Add("#<probe_hit> = #5070");
                code.Add("O100 IF [#<probe_hit> EQ 1]");
                code.Add($"  G0 {axisUpper}{F(RapidProbeBounce * directionSign)}");
                code.Add("O100 ENDIF");
            }

            code.Add($"G38.2 {axisUpper}{F(-halfClearance * directionSign)} F150");
            code.Add($"G0 {axisUpper}{F(Bounce * directionSign)}");
            code.Add($"G38.2 {axisUpper}{F(-(Bounce + 1) * directionSign)} F75");
            code.Add(WaitCommand);
            code.Add($"#<{axisUpper}2> = {axisRegister}");
            code.Add($"G0 {axisUpper}[[#<{axisUpper}1>-#<{axisUpper}2>]/2]");
        }

        return code;
    }

    public static List<string> GetZProbeRoutine(string selectedBitDiameter = "Auto")
    {
        return
        [
            $"(Probe Z - AutoZero Touch, {selectedBitDiameter})",
            "#<return_units> = [20 + #<_metric>]",
            "G21 G91",
            "G38.2 Z-25 F200",
            $"G0 Z{F(Bounce)}",
            $"G38.2 Z-{F(Bounce + 1)} F75",
            WaitCommand,
            $"G10 L20 Z{F(PlateThickness)}",
            "G0 Z5",
            "G90",
            "G[#<return_units>]"
        ];
    }

    public static List<string> GetXProbeRoutine(
        string selectedSide, string selectedBitDiameter = "Auto",
        double rapidMovement = 2000)
    {
        var spec = ResolveBitSpecification(selectedBitDiameter);
        var isLeft = selectedSide == "Left" ? 1 : -1;
        var halfClearance = AutoPlateInnerDimension / 2;
        var safeRapidDistance = ComputeSafeRapidDistance(spec.EffectiveDiameter);

        var code = new List<string>
        {
            $"(Probe X - {selectedSide}, AutoZero Touch - {spec.DisplayDiameter})",
            "#<return_units> = [20 + #<_metric>]",
            "G91 G21"
        };

        code.AddRange(BuildAxisProbeSequence("X", isLeft, spec,
            halfClearance, safeRapidDistance, rapidMovement));

        code.Add($"G10 L20 X{F(halfClearance * isLeft)}");
        code.Add("G90");
        code.Add("G[#<return_units>]");

        return code;
    }

    public static List<string> GetYProbeRoutine(
        string selectedSide, string selectedBitDiameter = "Auto",
        double rapidMovement = 2000)
    {
        var spec = ResolveBitSpecification(selectedBitDiameter);
        var isBottom = selectedSide == "Front" ? 1 : -1;
        var halfClearance = AutoPlateInnerDimension / 2;
        var safeRapidDistance = ComputeSafeRapidDistance(spec.EffectiveDiameter);

        var code = new List<string>
        {
            $"(Probe Y - {selectedSide}, AutoZero Touch - {spec.DisplayDiameter})",
            "#<return_units> = [20 + #<_metric>]",
            "G91 G21"
        };

        code.AddRange(BuildAxisProbeSequence("Y", isBottom, spec,
            halfClearance, safeRapidDistance, rapidMovement));

        code.Add($"G10 L20 Y{F(halfClearance * isBottom)}");
        code.Add("G90");
        code.Add("G[#<return_units>]");

        return code;
    }

    public static List<string> GetXYProbeRoutine(
        string selectedCorner, string selectedBitDiameter = "Auto",
        double rapidMovement = 2000, bool moveToZWorkspace = false,
        bool skipZMovement = false)
    {
        var spec = ResolveBitSpecification(selectedBitDiameter);
        var isLeft = selectedCorner is "TopLeft" or "BottomLeft" ? 1 : -1;
        var isBottom = selectedCorner is "BottomLeft" or "BottomRight" ? 1 : -1;
        var halfClearance = AutoPlateInnerDimension / 2;
        var safeRapidDistance = ComputeSafeRapidDistance(spec.EffectiveDiameter);

        var code = new List<string>
        {
            $"(Probe XY - {selectedCorner}, AutoZero Touch - {spec.DisplayDiameter})",
            "#<return_units> = [20 + #<_metric>]",
            "G91 G21"
        };

        if (!skipZMovement && spec.IsTip)
        {
            code.Add("G38.2 Z-15 F150");
            code.Add("G0 Z1");
        }

        code.AddRange(BuildAxisProbeSequence("X", isLeft, spec,
            halfClearance, safeRapidDistance, rapidMovement));

        code.AddRange(BuildAxisProbeSequence("Y", isBottom, spec,
            halfClearance, safeRapidDistance, rapidMovement));

        code.Add($"G10 L20 X{F(halfClearance * isLeft)} Y{F(halfClearance * isBottom)}");
        code.Add("G90");
        code.Add($"G38.3 X0 Y0 F{F(rapidMovement)}");

        if (moveToZWorkspace)
            code.Add($"G38.3 Z0 F{F(rapidMovement)}");

        code.Add("G[#<return_units>]");

        return code;
    }

    public static List<string> GetXYZProbeRoutine(
        string selectedCorner, string selectedBitDiameter = "Auto",
        double rapidMovement = 2000)
    {
        var spec = ResolveBitSpecification(selectedBitDiameter);

        var code = new List<string>();
        code.AddRange(GetZProbeRoutine(spec.DisplayDiameter));

        code.AddRange(GetXYProbeRoutine(
            selectedCorner, spec.DisplayDiameter, rapidMovement,
            moveToZWorkspace: true, skipZMovement: true));

        return code;
    }

    private static string F(double value) =>
        value.ToString(CultureInfo.InvariantCulture);
}
