using System.Globalization;

namespace NcSender.Server.Connection;

/// <summary>
/// `(DONGLE_WAIT:&lt;name&gt;:&lt;field&gt;=&lt;target&gt;:&lt;tolerance&gt;:&lt;timeoutSec&gt;)` —
/// hold the command stream at this line until the named accessory reports
/// <c>field</c> within <c>tolerance</c> of <c>target</c>, or the timeout passes.
/// Pairs with a preceding `(DONGLE:…)` send: e.g. AutoDustBoot sends
/// `goto:0`, then waits for `pos=0` instead of dwelling a fixed G4, so a boot
/// already retracted costs nothing and a slow move is waited out.
///
/// With a fifth field, `else`, the plugin handles a failed wait itself: the
/// lines between the `(DONGLE_ELSE)` and `(DONGLE_END)` markers that follow
/// run only when the wait failed (and are skipped when it succeeded), with no
/// generic pause and no re-send of the last command. That is what lets a
/// sensor on an accessory do what M66 plus an o-word `if` does for a wired
/// one: lift clear, show the plugin's own message, pause, return.
/// </summary>
public sealed record DongleWait(string Name, string Field, long Target, long Tolerance, int TimeoutMs, bool Else = false)
{
    private const string Prefix = "(DONGLE_WAIT:";
    public const string ElseMarker = "(DONGLE_ELSE)";
    public const string EndMarker = "(DONGLE_END)";

    public static bool IsElseMarker(string command) => string.Equals(command.Trim(), ElseMarker, StringComparison.OrdinalIgnoreCase);
    public static bool IsEndMarker(string command) => string.Equals(command.Trim(), EndMarker, StringComparison.OrdinalIgnoreCase);

    public static DongleWait? TryParse(string command)
    {
        if (!command.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase) || !command.EndsWith(')'))
            return null;
        var parts = command.Substring(Prefix.Length, command.Length - Prefix.Length - 1).Split(':');
        if (parts.Length is not (4 or 5)) return null;
        var hasElse = parts.Length == 5;
        if (hasElse && !string.Equals(parts[4].Trim(), "else", StringComparison.OrdinalIgnoreCase)) return null;
        var eq = parts[1].IndexOf('=');
        if (eq <= 0) return null;
        var name = parts[0].Trim();
        var field = parts[1][..eq].Trim();
        if (name.Length == 0 || field.Length == 0
            || !long.TryParse(parts[1][(eq + 1)..].Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var target)
            || !long.TryParse(parts[2].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var tolerance)
            || !double.TryParse(parts[3].Trim(), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var timeoutSec)
            || timeoutSec <= 0)
            return null;
        // Capped so a typo can never park the machine for minutes.
        var timeoutMs = (int)Math.Min(timeoutSec * 1000, 30000);
        return new DongleWait(name, field, target, tolerance, timeoutMs, hasElse);
    }

    // Accessory names as the operator knows them; anything else shows as-is.
    private static readonly Dictionary<string, string> DisplayNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["autodustboot"] = "Dust boot",
        ["xio"] = "Wireless I/O",
    };

    public string DisplayName => DisplayNames.TryGetValue(Name, out var n) ? n : Name;

    /// <summary>
    /// Written in place of the sentinel when the accessory never answered: the
    /// operator pause dialog (NCSENDER_PAUSE + M0 — Continue releases the hold,
    /// Abort soft-resets). Plain text; no parentheses inside a g-code comment.
    /// </summary>
    public string PauseLine() =>
        $"(MSG, NCSENDER_PAUSE: {DisplayName} not responding | {DisplayName} did not confirm it moved. "
        + "Continue only if you have checked it is clear of the tool and the work, Abort to stop the job.)M0";
}
