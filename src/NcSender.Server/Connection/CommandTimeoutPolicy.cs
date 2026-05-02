using System.Globalization;
using System.Text.RegularExpressions;

namespace NcSender.Server.Connection;

/// <summary>
/// Per-command response timeout policy. Prevents the queue from stalling when
/// the controller drops or delays an "ok" ack. A null timeout means wait
/// indefinitely (e.g. M0 program-stop, which holds until the user sends ~).
/// </summary>
public static partial class CommandTimeoutPolicy
{
    private static readonly TimeSpan LongMechanical = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Probing = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan Motion = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan Default = TimeSpan.FromMilliseconds(500);

    public static TimeSpan? GetTimeout(string command)
    {
        var trimmed = (command ?? "").Trim();

        // Indefinite: M0 / M1 (program stop) hold until cycle-start `~`;
        // M6 (tool change) may prompt the user via a plugin dialog.
        if (IndefiniteHoldRegex().IsMatch(trimmed))
            return null;

        // Long mechanical: homing on big machines, traverse to predefined.
        if (LongMechanicalRegex().IsMatch(trimmed))
            return LongMechanical;

        // Probing: travels over the configured search distance at slow feed.
        if (ProbingRegex().IsMatch(trimmed))
            return Probing;

        // Dwell: G4 P<seconds>. Self-describing — parse and add a buffer.
        var dwell = DwellRegex().Match(trimmed);
        if (dwell.Success && double.TryParse(dwell.Groups[1].Value,
                NumberStyles.Float, CultureInfo.InvariantCulture, out var dwellSec))
        {
            return TimeSpan.FromSeconds(dwellSec + 2);
        }

        // Motion: planner buffer can delay the ack on long slow feeds.
        if (MotionRegex().IsMatch(trimmed))
            return Motion;

        // Everything else (jogs, queries, modes, spindle, coolant, etc.)
        // acks in tens of milliseconds; a tight timeout makes a stuck
        // queue recover quickly.
        return Default;
    }

    [GeneratedRegex(@"\bM0*[01]\b|\bM0*6\b", RegexOptions.IgnoreCase)]
    private static partial Regex IndefiniteHoldRegex();

    [GeneratedRegex(@"^\s*\$H[A-Z]?\b|\bG0*2[89]\b|\bG0*30\b", RegexOptions.IgnoreCase)]
    private static partial Regex LongMechanicalRegex();

    [GeneratedRegex(@"\bG0*38\.[2-5]\b", RegexOptions.IgnoreCase)]
    private static partial Regex ProbingRegex();

    [GeneratedRegex(@"\bG0*4\b[^P]*P(\d+(?:\.\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex DwellRegex();

    [GeneratedRegex(@"\bG0*[0-3]\b", RegexOptions.IgnoreCase)]
    private static partial Regex MotionRegex();
}
