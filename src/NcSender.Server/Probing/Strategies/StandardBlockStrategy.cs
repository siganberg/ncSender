using System.Globalization;

namespace NcSender.Server.Probing.Strategies;

public static class StandardBlockStrategy
{
    private const double ZParkHeight = 4;

    public static List<string> GetZProbeRoutine(double zThickness = 15)
    {
        return
        [
            "(Probe Z - Standard Block)",
            "#<return_units> = [20 + #<_metric>]",
            "G21 G91",
            "G38.2 Z-30 F200",
            "G0 Z4",
            "G4 P0.1",
            "G38.2 Z-5 F75",
            $"G10 L20 Z{F(zThickness)}",
            $"G0 Z{F(ZParkHeight)}",
            "G90",
            "G[#<return_units>]"
        ];
    }

    public static List<string> GetXProbeRoutine(
        string selectedSide, double xyThickness = 10, double bitDiameter = 6.35)
    {
        var bitRadius = bitDiameter / 2;
        var isLeft = selectedSide == "Left";
        var fastProbe = isLeft ? 30 : -30;
        var bounce = isLeft ? -4 : 4;
        var slowProbe = isLeft ? 5 : -5;
        var offset = isLeft ? -(xyThickness + bitRadius) : (xyThickness + bitRadius);
        var moveAway = isLeft ? -4 : 4;

        return
        [
            $"(Probe X - {selectedSide}, Standard Block, {F(bitDiameter)}mm bit)",
            "#<return_units> = [20 + #<_metric>]",
            "G10 L20 X0",
            "G91 G21",
            $"G38.2 X{F(fastProbe)} F150",
            $"G0 X{F(bounce)}",
            $"G38.2 X{F(slowProbe)} F75",
            "G4 P0.3",
            $"G10 L20 X{F(offset)}",
            $"G0 X{F(moveAway)}",
            "G90",
            "G[#<return_units>]"
        ];
    }

    public static List<string> GetYProbeRoutine(
        string selectedSide, double xyThickness = 10, double bitDiameter = 6.35)
    {
        var bitRadius = bitDiameter / 2;
        var isFront = selectedSide == "Front";
        var fastProbe = isFront ? 30 : -30;
        var bounce = isFront ? -4 : 4;
        var slowProbe = isFront ? 5 : -5;
        var offset = isFront ? -(xyThickness + bitRadius) : (xyThickness + bitRadius);
        var moveAway = isFront ? -4 : 4;

        return
        [
            $"(Probe Y - {selectedSide}, Standard Block, {F(bitDiameter)}mm bit)",
            "#<return_units> = [20 + #<_metric>]",
            "G10 L20 Y0",
            "G91 G21",
            $"G38.2 Y{F(fastProbe)} F150",
            $"G0 Y{F(bounce)}",
            $"G38.2 Y{F(slowProbe)} F75",
            "G4 P0.3",
            $"G10 L20 Y{F(offset)}",
            $"G0 Y{F(moveAway)}",
            "G90",
            "G[#<return_units>]"
        ];
    }

    public static List<string> GetXYProbeRoutine(
        string selectedCorner, double xyThickness = 10,
        double bitDiameter = 6.35, bool skipPrepMove = false)
    {
        var bitRadius = bitDiameter / 2;
        var isLeft = selectedCorner is "TopLeft" or "BottomLeft";
        var isBottom = selectedCorner is "BottomLeft" or "BottomRight";

        var xProbe = isLeft ? 30 : -30;
        var yProbe = isBottom ? 30 : -30;
        var xRetract = isLeft ? -4 : 4;
        var yRetract = isBottom ? -4 : 4;
        var xSlow = isLeft ? 5 : -5;
        var ySlow = isBottom ? 5 : -5;
        var xOffset = isLeft ? -(xyThickness + bitRadius) : (xyThickness + bitRadius);
        var yOffset = isBottom ? -(xyThickness + bitRadius) : (xyThickness + bitRadius);

        var xMove = isLeft ? (xyThickness + bitDiameter + 5) : -(xyThickness + bitDiameter + 5);
        var yMove = isBottom ? (xyThickness + bitDiameter + 5) : -(xyThickness + bitDiameter + 5);

        var code = new List<string>
        {
            $"(Probe XY - {selectedCorner}, Standard Block, {F(bitDiameter)}mm bit)",
            "#<return_units> = [20 + #<_metric>]",
            "G91 G21"
        };

        if (!skipPrepMove)
        {
            code.Add($"G0 X{F(xRetract)} Y{F(yRetract)}");
            code.Add($"G0 Y{F(yMove)}");
        }

        code.Add($"G38.2 X{F(xProbe)} F150");
        code.Add($"G0 X{F(xRetract)}");
        code.Add($"G38.2 X{F(xSlow)} F75");
        code.Add("G4 P0.3");
        code.Add($"G10 L20 X{F(xOffset)}");

        code.Add($"G0 X{F(xRetract * 2)}");
        code.Add($"G0 Y{F(-yMove + yRetract)}");
        code.Add($"G0 X{F(xMove - xRetract)}");

        code.Add($"G38.2 Y{F(yProbe)} F150");
        code.Add($"G0 Y{F(yRetract)}");
        code.Add($"G38.2 Y{F(ySlow)} F75");
        code.Add("G4 P0.3");
        code.Add($"G10 L20 Y{F(yOffset)}");
        code.Add($"G0 Y{F(yRetract)}");

        code.Add("G0 Z10");
        code.Add("G90 G0 X0 Y0");
        code.Add("G21");
        code.Add("G[#<return_units>]");

        return code;
    }

    public static List<string> GetXYZProbeRoutine(
        string selectedCorner, double xyThickness = 10,
        double zThickness = 15, double zProbeDistance = 3,
        double bitDiameter = 6.35)
    {
        var isLeft = selectedCorner is "TopLeft" or "BottomLeft";
        var xMove = isLeft ? -(xyThickness + bitDiameter + 5) : (xyThickness + bitDiameter + 5);

        var code = new List<string>();
        code.AddRange(GetZProbeRoutine(zThickness));

        code.Add("G91");
        code.Add($"G0 X{F(xMove)}");
        code.Add($"G0 Z-{F(zProbeDistance + ZParkHeight)}");

        code.AddRange(GetXYProbeRoutine(selectedCorner, xyThickness, bitDiameter, skipPrepMove: true));

        return code;
    }

    private static string F(double value) =>
        value.ToString(CultureInfo.InvariantCulture);
}
