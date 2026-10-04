using System.Text.RegularExpressions;
using NcSender.Core.Models;

namespace NcSender.Server.CommandProcessor;

/// <summary>
/// The lines that bracket every M6 / $TLS sequence. The controller echoes a
/// (MSG, ...) comment when it reaches it, e.g. grblHAL "[MSG:TOOL_CHANGE_START 7]",
/// which is how ncSender knows a sequence started or finished on the
/// controller. The number ties the echo back to <see cref="Core.Interfaces.IToolChangeTracker"/>.
/// </summary>
public static partial class ToolChangeSentinel
{
    private static CommandMeta SystemSilent => new() { SourceId = "system", Silent = true };

    public static ProcessedCommand Start(int id) => new()
    {
        Command = $"(MSG, TOOL_CHANGE_START{Suffix(id)})",
        DisplayCommand = "(tool change sentinel)",
        IsOriginal = false,
        Meta = SystemSilent,
    };

    // G4 P0 waits for every queued move to finish. Without it the controller
    // would echo the COMPLETE message when it parses the line, while the
    // last moves of the sequence (the return, a plugin's own after-change
    // moves) are still in its motion buffer.
    public static ProcessedCommand Sync() => new()
    {
        Command = "G4 P0",
        DisplayCommand = "(tool change sentinel)",
        IsOriginal = false,
        Meta = SystemSilent,
    };

    // A cleanup line: still sent when the controller rejected a line of the
    // sequence, so the tracker must already have ended the change as aborted.
    public static ProcessedCommand Complete(int id) => new()
    {
        Command = $"(MSG, TOOL_CHANGE_COMPLETE{Suffix(id)})",
        DisplayCommand = "(tool change sentinel)",
        IsOriginal = false,
        Cleanup = true,
        Meta = SystemSilent,
    };

    // No tracker (tests): the plain sentinel.
    private static string Suffix(int id) => id > 0 ? $" {id}" : "";

    /// <summary>Reads a controller line; kind is "START" or "COMPLETE", id 0 when the line has none.</summary>
    public static bool TryParse(string data, out string kind, out int id)
    {
        var m = SentinelPattern().Match(data);
        kind = m.Success ? m.Groups[1].Value.ToUpperInvariant() : "";
        id = m.Success && m.Groups[2].Success ? int.Parse(m.Groups[2].Value) : 0;
        return m.Success;
    }

    [GeneratedRegex(@"TOOL_CHANGE_(START|COMPLETE)(?:\s*(\d+))?", RegexOptions.IgnoreCase)]
    private static partial Regex SentinelPattern();
}
