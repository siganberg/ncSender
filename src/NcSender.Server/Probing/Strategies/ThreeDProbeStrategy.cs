using System.Globalization;

namespace NcSender.Server.Probing.Strategies;

public static class ThreeDProbeStrategy
{
    private const double ZParkHeight = 4;

    public static List<string> GetZProbeRoutine(double zOffset = 0)
    {
        return
        [
            "(Probe Z)",
            "#<return_units> = [20 + #<_metric>]",
            "G21 G91",
            "G38.2 Z-25 F200",
            "G0 Z4",
            "G38.2 Z-5 F75",
            "G4 P0.3",
            $"G10 L20 Z{F(zOffset)}",
            $"G0 Z{F(ZParkHeight)}",
            "G90",
            "G[#<return_units>]"
        ];
    }

    public static List<string> GetXProbeRoutine(string selectedSide, double toolDiameter = 6)
    {
        var toolRadius = toolDiameter / 2;
        var isLeft = selectedSide == "Left";

        var fastProbe = isLeft ? 30 : -30;
        var bounce = isLeft ? -4 : 4;
        var slowProbe = isLeft ? 5 : -5;
        var offset = isLeft ? -toolRadius : toolRadius;
        var moveAway = isLeft ? -4 : 4;

        return
        [
            $"(Probe X - {selectedSide})",
            "#<return_units> = [20 + #<_metric>]",
            "G10 L20 X0",
            "G91 G21",
            $"G38.2 X{F(fastProbe)} F150",
            $"G91 G0 X{F(bounce)}",
            $"G38.2 X{F(slowProbe)} F75",
            "G4 P0.3",
            $"G10 L20 X{F(offset)}",
            $"G0 X{F(moveAway)}",
            "G90",
            "G[#<return_units>]"
        ];
    }

    public static List<string> GetYProbeRoutine(string selectedSide, double toolDiameter = 6)
    {
        var toolRadius = toolDiameter / 2;
        var isFront = selectedSide == "Front";

        var fastProbe = isFront ? 30 : -30;
        var bounce = isFront ? -4 : 4;
        var slowProbe = isFront ? 5 : -5;
        var offset = isFront ? -toolRadius : toolRadius;
        var moveAway = isFront ? -4 : 4;

        return
        [
            $"(Probe Y - {selectedSide})",
            "#<return_units> = [20 + #<_metric>]",
            "G10 L20 Y0",
            "G91 G21",
            $"G38.2 Y{F(fastProbe)} F150",
            $"G91 G0 Y{F(bounce)}",
            $"G38.2 Y{F(slowProbe)} F75",
            "G4 P0.3",
            $"G10 L20 Y{F(offset)}",
            $"G0 Y{F(moveAway)}",
            "G90",
            "G[#<return_units>]"
        ];
    }

    public static List<string> GetXYProbeRoutine(
        string selectedCorner, double toolDiameter = 6,
        bool skipPrepMove = false, double zPlunge = 3)
    {
        var toolRadius = toolDiameter / 2;

        var isLeft = selectedCorner is "TopLeft" or "BottomLeft";
        var isBottom = selectedCorner is "BottomLeft" or "BottomRight";

        var xProbe = isLeft ? 30 : -30;
        var yProbe = isBottom ? 30 : -30;
        var xRetract = isLeft ? -4 : 4;
        var yRetract = isBottom ? -4 : 4;
        var xSlow = isLeft ? 5 : -5;
        var ySlow = isBottom ? 5 : -5;
        var xOffset = isLeft ? -toolRadius : toolRadius;
        var yOffset = isBottom ? -toolRadius : toolRadius;

        var xMove = isLeft ? (toolDiameter + 16) : -(toolDiameter + 16);
        var yMove = isBottom ? (toolDiameter + 16) : -(toolDiameter + 16);

        var zRetract = zPlunge + ZParkHeight;

        var code = new List<string>
        {
            $"(Probe XY - {selectedCorner})",
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
        code.Add($"G0 X{F(xMove)}");

        code.Add($"G38.2 Y{F(yProbe)} F150");
        code.Add($"G91 G0 Y{F(yRetract)}");
        code.Add($"G38.2 Y{F(ySlow)} F75");
        code.Add("G4 P0.3");
        code.Add($"G10 L20 Y{F(yOffset)}");
        code.Add($"G0 Y{F(yRetract)}");

        code.Add($"G0 Z{F(zRetract)}");
        code.Add("G90 G0 X0 Y0");
        code.Add("G21");
        code.Add("G[#<return_units>]");

        return code;
    }

    public static List<string> GetXYZProbeRoutine(
        string selectedCorner, double toolDiameter = 6,
        double zPlunge = 3, double zOffset = 0)
    {
        var isLeft = selectedCorner is "TopLeft" or "BottomLeft";
        var xMove = isLeft ? -(toolDiameter + 16) : (toolDiameter + 16);

        var code = new List<string>();
        code.AddRange(GetZProbeRoutine(zOffset));

        code.Add("G91");
        code.Add($"G0 X{F(xMove)}");
        code.Add($"G38.3 Z-{F(zPlunge + ZParkHeight)} F150");

        code.AddRange(GetXYProbeRoutine(selectedCorner, toolDiameter, skipPrepMove: true, zPlunge));

        return code;
    }

    public static List<string> GetCenterInnerRoutine(
        double xDimension, double yDimension, double toolDiameter = 2,
        double rapidMovement = 2000, double zPlunge = 3)
    {
        var halfX = xDimension / 2;
        var halfY = yDimension / 2;
        const int searchFeed = 150;
        const int slowFeed = 75;
        const int bounce = 2;
        const int maxSearchLimit = 30;
        const int safeDistance = 5;

        var safeRapidX = halfX - toolDiameter - safeDistance;
        var safeRapidY = halfY - toolDiameter - safeDistance;

        var code = new List<string>
        {
            "(Probing Center - Inner)",
            "#<return_units> = [20 + #<_metric>]",
            $"#<X_SIZE> = {F(xDimension)} (Estimated X dimension, mm)",
            $"#<Y_SIZE> = {F(yDimension)} (Estimated Y dimension, mm)",
            $"#<RAPID_SEARCH> = {F(rapidMovement)}",
            "G21 (mm mode)",
            "G91 (incremental)",
            $"G38.3 Z-{F(zPlunge + 4)}  F{searchFeed}"
        };

        if (safeRapidX > 0)
            code.Add($"G38.3 X-{F(safeRapidX)} F#<RAPID_SEARCH>");

        code.Add($"G38.2 X-{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 X{bounce}");
        code.Add($"G38.2 X-3 F{slowFeed}");
        code.Add("#<X1> = #5061");
        code.Add($"G0 X{F(halfX)}");

        if (safeRapidX > 0)
            code.Add($"G38.3 X{F(safeRapidX - toolDiameter / 2)} F#<RAPID_SEARCH>");

        code.Add($"G38.2 X{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 X-{bounce}");
        code.Add($"G38.2 X3 F{slowFeed}");
        code.Add("#<X2> = #5061");
        // FluidNC rejects "G0 X-[expr]" (leading minus on a bracketed
        // expression — invalid per LinuxCNC G-code spec). Swap operands so the
        // result is naturally negative; grblHAL accepts both forms. (issue #55)
        code.Add("G0 X[[#<X1>-#<X2>]/2]");

        if (safeRapidY > 0)
            code.Add($"G38.3 Y-{F(safeRapidY)} F#<RAPID_SEARCH>");

        code.Add($"G38.2 Y-{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 Y{bounce}");
        code.Add($"G38.2 Y-3 F{slowFeed}");
        code.Add("#<Y1> = #5062");
        code.Add($"G0 Y{F(halfY)}");

        if (safeRapidY > 0)
            code.Add($"G38.3 Y{F(safeRapidY - toolDiameter / 2)} F#<RAPID_SEARCH>");

        code.Add($"G38.2 Y{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 Y-{bounce}");
        code.Add($"G38.2 Y3 F{slowFeed}");
        code.Add("#<Y2> = #5062");
        code.Add("G0 Y[[#<Y1>-#<Y2>]/2]");
        code.Add("G10 L20 X0 Y0");
        code.Add($"G0 Z{F(zPlunge + 4)}");
        code.Add("G90");
        code.Add("G[#<return_units>]");

        return code;
    }

    public static List<string> GetCenterOuterRoutine(
        double xDimension, double yDimension, double toolDiameter = 2,
        double rapidMovement = 2000, bool probeZFirst = false,
        double zPlunge = 3, double zOffset = 0)
    {
        var halfX = xDimension / 2;
        var halfY = yDimension / 2;
        const int searchFeed = 150;
        const int slowFeed = 75;
        const int bounce = 2;
        const int maxSearchLimit = 30;
        const int safeDistance = 5;
        var zHop = zPlunge + ZParkHeight;

        var safeRapidX = halfX + toolDiameter + safeDistance;
        var safeRapidY = halfY + toolDiameter + safeDistance;

        var code = new List<string>();

        if (probeZFirst)
            code.AddRange(GetZProbeRoutine(zOffset));

        code.Add("(Probing Center - Outer)");
        code.Add("#<return_units> = [20 + #<_metric>]");
        code.Add($"#<X_SIZE> = {F(xDimension)} (Estimated X dimension, mm)");
        code.Add($"#<Y_SIZE> = {F(yDimension)} (Estimated Y dimension, mm)");
        code.Add($"#<RAPID_SEARCH> = {F(rapidMovement)}");
        code.Add("G21 (mm mode)");
        code.Add("G91 (incremental)");

        if (safeRapidX > 0)
            code.Add($"G38.3 X-{F(safeRapidX)} F#<RAPID_SEARCH>");

        code.Add($"G38.3 Z-{F(zHop)} F200");
        code.Add($"G38.2 X{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 X-{bounce}");
        code.Add($"G38.2 X{F(bounce + 1)} F{slowFeed}");
        code.Add("#<X1> = #5061");
        code.Add($"G0 X-{bounce}");
        code.Add($"G0 Z{F(zHop)}");
        code.Add($"G0 X{bounce}");
        code.Add($"G0 X{F(halfX)}");

        if (safeRapidX > 0)
            code.Add($"G38.3 X{F(safeRapidX)} F#<RAPID_SEARCH>");

        code.Add($"G38.3 Z-{F(zHop)} F200");
        code.Add($"G38.2 X-{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 X{bounce}");
        code.Add($"G38.2 X-{F(bounce + 1)} F{slowFeed}");
        code.Add("#<X2> = #5061");
        code.Add($"G0 X{bounce}");
        code.Add($"G0 Z{F(zHop)}");
        code.Add($"G0 X-{bounce}");
        code.Add("G0 X[[#<X1>-#<X2>]/2]");

        if (safeRapidY > 0)
            code.Add($"G38.3 Y-{F(safeRapidY)} F#<RAPID_SEARCH>");

        code.Add($"G38.3 Z-{F(zHop)} F200");
        code.Add($"G38.2 Y{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 Y-{bounce}");
        code.Add($"G38.2 Y+{F(bounce + 1)} F{slowFeed}");
        code.Add("#<Y1> = #5062");
        code.Add($"G0 Y-{bounce}");
        code.Add($"G0 Z{F(zHop)}");
        code.Add($"G0 Y{bounce}");
        code.Add($"G0 Y{F(halfY)}");

        if (safeRapidY > 0)
            code.Add($"G38.3 Y{F(safeRapidY)} F#<RAPID_SEARCH>");

        code.Add($"G38.3 Z-{F(zHop)} F200");
        code.Add($"G38.2 Y-{maxSearchLimit} F{searchFeed}");
        code.Add($"G0 Y{bounce}");
        code.Add($"G38.2 Y-{F(bounce + 1)} F{slowFeed}");
        code.Add("#<Y2> = #5062");
        code.Add($"G0 Y{bounce}");
        code.Add($"G0 Z{F(zHop)}");
        code.Add($"G0 Y-{bounce}");
        code.Add("G0 Y[[#<Y1>-#<Y2>]/2]");
        code.Add("G10 L20 X0 Y0");
        code.Add("G90");
        code.Add("G[#<return_units>]");

        return code;
    }

    private static string F(double value) =>
        value.ToString(CultureInfo.InvariantCulture);
}
