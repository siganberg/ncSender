using System.Globalization;
using System.Text.RegularExpressions;
using NcSender.Core.Models;

namespace NcSender.Server.Probing;

/// <summary>
/// Measures the hole or part a Center probe ran on. The routine stores each
/// wall's touch with <c>#&lt;X1&gt; = #5061</c> (and X2, Y1, Y2) right after
/// the slow probe, so the <c>[PRB:...]</c> report just before each of those
/// lines is that wall. The size is the distance between the walls plus the
/// tip diameter for a hole (Inner) or minus it for a part (Outer).
/// </summary>
internal sealed partial class CenterMeasurement
{
    private readonly bool _inner;
    private readonly double _tipDiameter;
    private readonly Lock _lock = new();
    private double[]? _lastProbe;
    private readonly Dictionary<string, double> _walls = [];

    private CenterMeasurement(bool inner, double tipDiameter)
    {
        _inner = inner;
        _tipDiameter = tipDiameter;
    }

    /// <summary>A measurement for a Center routine, or null for any other.</summary>
    public static CenterMeasurement? For(IReadOnlyList<string> commands, double tipDiameter)
    {
        foreach (var cmd in commands)
        {
            var trimmed = cmd.Trim();
            if (trimmed == "(Probing Center - Inner)") return new CenterMeasurement(true, tipDiameter);
            if (trimmed == "(Probing Center - Outer)") return new CenterMeasurement(false, tipDiameter);
        }
        return null;
    }

    /// <summary>A line from the controller; picks up <c>[PRB:x,y,z:1]</c>.</summary>
    public void OnData(string data)
    {
        var line = data.Trim();
        if (!line.StartsWith("[PRB:", StringComparison.Ordinal) || !line.EndsWith(']')) return;
        var body = line[5..^1];
        var colon = body.LastIndexOf(':');
        if (colon < 0) return;
        var coords = body[..colon].Split(',');
        double[]? probe = null;
        if (body[(colon + 1)..].Trim() == "1" && coords.Length >= 2 &&
            double.TryParse(coords[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var x) &&
            double.TryParse(coords[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var y))
            probe = [x, y];
        lock (_lock) _lastProbe = probe;
    }

    /// <summary>A routine line about to be sent; records the wall it stores.</summary>
    public void OnCommand(string command)
    {
        var m = WallAssignment().Match(command);
        if (!m.Success) return;
        lock (_lock)
        {
            if (_lastProbe is null) return;
            var wall = m.Groups[1].Value;
            _walls[wall] = wall[0] == 'X' ? _lastProbe[0] : _lastProbe[1];
        }
    }

    public ProbeResult Result()
    {
        lock (_lock)
            return new ProbeResult { MeasuredX = Size("X1", "X2"), MeasuredY = Size("Y1", "Y2") };
    }

    private double? Size(string a, string b)
    {
        if (!_walls.TryGetValue(a, out var p1) || !_walls.TryGetValue(b, out var p2)) return null;
        var size = Math.Abs(p2 - p1) + (_inner ? _tipDiameter : -_tipDiameter);
        return size > 0 ? Math.Round(size, 3) : null;
    }

    [GeneratedRegex(@"^#<([XY][12])>\s*=\s*#506[12]\b")]
    private static partial Regex WallAssignment();
}
