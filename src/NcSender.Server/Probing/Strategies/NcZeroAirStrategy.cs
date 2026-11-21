using System.Globalization;

namespace NcSender.Server.Probing.Strategies;

/// <summary>
/// The ncZeroAir Probe: a 60 x 60 x 29 mm block with a 30 mm hole, 20 mm deep,
/// in the middle of its top face. It sits on a corner of the material with its
/// lip against both edges.
///
/// Two ways to use it. In the hole ("hole" mode) the tool touches the wall on
/// four sides; the middle of each pair is the hole's centre whatever the tool's
/// diameter, and the corner is a fixed distance from it. On the outside
/// ("edge" mode) it is an ordinary touch block: the top face and the two outer
/// sides, with the tool's diameter given.
/// </summary>
public static class NcZeroAirStrategy
{
    // The block, in mm.
    private const double BlockSize = 60;
    private const double HoleDiameter = 30;
    private const double HoleDepth = 20;
    /// <summary>Top face above the material.</summary>
    public const double TopToMaterial = 25;
    /// <summary>Outer side faces outside the material's edges.</summary>
    public const double SideToMaterial = 10;

    private const double HoleCentreToCorner = BlockSize / 2 - SideToMaterial;   // 20
    private const double HoleFloorToMaterial = TopToMaterial - HoleDepth;       // 5

    /// <summary>Where the tool is left once the zero is set: this far above the top face.</summary>
    private const double ParkAboveTop = 3;

    private const double Bounce = 2;
    private const double ZBounce = 3;
    private const double SeekFeed = 300;
    private const double TouchFeed = 75;
    private const string WaitCommand = "G4 P0.1";

    /// <summary>How far below the top face the tool goes to reach the outer sides.</summary>
    private const double EdgeZProbeDistance = 5;

    // ---- Z alone ----

    /// <summary>
    /// Z on the floor of the hole, the probe sitting as usual. Ends above the
    /// top face, out of the hole.
    /// </summary>
    public static List<string> GetHoleZProbeRoutine()
    {
        return
        [
            "(Probe Z - AutoZeroAir, in the hole)",
            "#<return_units> = [20 + #<_metric>]",
            "G21 G91",
            $"G38.2 Z-{F(HoleDepth + 25)} F200",
            $"G0 Z{F(ZBounce)}",
            $"G38.2 Z-{F(ZBounce + 1)} F{F(TouchFeed)}",
            WaitCommand,
            $"G10 L20 Z{F(HoleFloorToMaterial)}",
            "G90",
            $"G0 Z{F(TopToMaterial + ParkAboveTop)}",
            "G[#<return_units>]"
        ];
    }

    /// <summary>
    /// Z on the top face, by the corner mark and clear of the hole. Ends just
    /// above it.
    /// </summary>
    public static List<string> GetTopZProbeRoutine()
    {
        return
        [
            "(Probe Z - AutoZeroAir, top face)",
            "#<return_units> = [20 + #<_metric>]",
            "G21 G91",
            "G38.2 Z-30 F200",
            $"G0 Z{F(ZBounce)}",
            $"G38.2 Z-{F(ZBounce + 1)} F{F(TouchFeed)}",
            WaitCommand,
            $"G10 L20 Z{F(TopToMaterial)}",
            $"G0 Z{F(ParkAboveTop)}",
            "G90",
            "G[#<return_units>]"
        ];
    }

    // ---- In the hole ----

    /// <summary>
    /// Touch both walls along one axis and stop halfway between them. A chord of
    /// a circle is centred on the circle, so this is the hole's centre on that
    /// axis even when the tool starts off-centre on the other one.
    /// </summary>
    public static List<string> BuildHoleAxisSequence(string axis)
    {
        var a = axis.ToUpperInvariant();
        var register = a == "X" ? "#5061" : "#5062";
        var radius = HoleDiameter / 2;

        return
        [
            $"G38.2 {a}{F(radius + 1)} F{F(SeekFeed)}",
            $"G0 {a}{F(-Bounce)}",
            $"G38.2 {a}{F(Bounce + 1)} F{F(TouchFeed)}",
            WaitCommand,
            $"#<{a}1> = {register}",
            $"G0 {a}{F(-Bounce)}",
            $"G38.2 {a}{F(-(HoleDiameter + 1))} F{F(SeekFeed)}",
            $"G0 {a}{F(Bounce)}",
            $"G38.2 {a}{F(-(Bounce + 1))} F{F(TouchFeed)}",
            WaitCommand,
            $"#<{a}2> = {register}",
            $"G0 {a}[[#<{a}1>-#<{a}2>]/2]"
        ];
    }

    public static List<string> GetHoleXProbeRoutine(string selectedSide)
    {
        var sign = selectedSide == "Left" ? 1 : -1;
        var code = Header($"Probe X - {selectedSide}, AutoZeroAir hole");
        code.AddRange(BuildHoleAxisSequence("X"));
        code.Add($"G10 L20 X{F(HoleCentreToCorner * sign)}");
        code.Add("G90");
        code.Add("G[#<return_units>]");
        return code;
    }

    public static List<string> GetHoleYProbeRoutine(string selectedSide)
    {
        var sign = selectedSide == "Front" ? 1 : -1;
        var code = Header($"Probe Y - {selectedSide}, AutoZeroAir hole");
        code.AddRange(BuildHoleAxisSequence("Y"));
        code.Add($"G10 L20 Y{F(HoleCentreToCorner * sign)}");
        code.Add("G90");
        code.Add("G[#<return_units>]");
        return code;
    }

    /// <summary>
    /// XY from inside the hole. Z is not known here, so the tool is left at the
    /// hole's centre: there is no safe height to leave by.
    /// </summary>
    public static List<string> GetHoleXYProbeRoutine(string selectedCorner)
    {
        var (x, y) = CornerSigns(selectedCorner);
        var code = Header($"Probe XY - {selectedCorner}, AutoZeroAir hole");
        code.AddRange(BuildHoleAxisSequence("X"));
        code.AddRange(BuildHoleAxisSequence("Y"));
        code.Add($"G10 L20 X{F(HoleCentreToCorner * x)} Y{F(HoleCentreToCorner * y)}");
        code.Add("G90");
        code.Add("G[#<return_units>]");
        return code;
    }

    /// <summary>
    /// Z on the hole's floor, then XY on its wall. Ends above the corner, clear
    /// of the block: the tool never goes down to the material.
    /// </summary>
    public static List<string> GetHoleXYZProbeRoutine(string selectedCorner)
    {
        var (x, y) = CornerSigns(selectedCorner);
        var code = Header($"Probe XYZ - {selectedCorner}, AutoZeroAir hole");

        code.Add($"G38.2 Z-{F(HoleDepth + 25)} F200");
        code.Add($"G0 Z{F(ZBounce)}");
        code.Add($"G38.2 Z-{F(ZBounce + 1)} F{F(TouchFeed)}");
        code.Add(WaitCommand);
        code.Add($"G10 L20 Z{F(HoleFloorToMaterial)}");
        code.Add($"G0 Z{F(ZBounce)}");

        code.AddRange(BuildHoleAxisSequence("X"));
        code.AddRange(BuildHoleAxisSequence("Y"));
        code.Add($"G10 L20 X{F(HoleCentreToCorner * x)} Y{F(HoleCentreToCorner * y)}");

        code.Add("G90");
        code.Add($"G0 Z{F(TopToMaterial + ParkAboveTop)}");
        code.Add("G0 X0 Y0");
        code.Add("G[#<return_units>]");
        return code;
    }

    // ---- On the outside: an ordinary touch block with this block's sizes ----

    public static List<string> GetEdgeXProbeRoutine(string selectedSide, double bitDiameter) =>
        StandardBlockStrategy.GetXProbeRoutine(selectedSide, SideToMaterial, bitDiameter);

    public static List<string> GetEdgeYProbeRoutine(string selectedSide, double bitDiameter) =>
        StandardBlockStrategy.GetYProbeRoutine(selectedSide, SideToMaterial, bitDiameter);

    public static List<string> GetEdgeXYProbeRoutine(string selectedCorner, double bitDiameter) =>
        StandardBlockStrategy.GetXYProbeRoutine(selectedCorner, SideToMaterial, bitDiameter);

    public static List<string> GetEdgeXYZProbeRoutine(string selectedCorner, double bitDiameter) =>
        StandardBlockStrategy.GetXYZProbeRoutine(selectedCorner, SideToMaterial, TopToMaterial,
            EdgeZProbeDistance, bitDiameter, SideToMaterial);

    private static List<string> Header(string title) =>
    [
        $"({title})",
        "#<return_units> = [20 + #<_metric>]",
        "G91 G21"
    ];

    // +1 when the corner is on the left / front: the hole's centre is then on
    // the positive side of the work zero.
    private static (int X, int Y) CornerSigns(string corner) =>
        (corner is "TopLeft" or "BottomLeft" ? 1 : -1,
         corner is "BottomLeft" or "BottomRight" ? 1 : -1);

    private static string F(double value) =>
        value.ToString(CultureInfo.InvariantCulture);
}
