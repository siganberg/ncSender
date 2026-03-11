using System.Globalization;
using System.Text.RegularExpressions;

namespace NcSender.Core.Utils;

public static partial class GcodePatterns
{
    // M6 tool change — ported from V1 with proper boundary checks.
    // Matches: M6, M06, M006, M6 T3, M06T12, T3 M6, T2M6
    // Does NOT match: M60, M61, M600, M6R2
    [GeneratedRegex(@"(?:^|[^A-Z])M0*6(?:\s*T0*(\d+)|(?=[^0-9T])|$)|(?:^|[^A-Z])T0*(\d+)\s*M0*6(?:[^0-9]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex M6Regex();

    // M3/M4 spindle start — boundary-checked to avoid matching M30, M40, etc.
    [GeneratedRegex(@"(?:^|[^A-Z])M0*[34](?:[^0-9]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex SpindleStartRegex();

    // M5 spindle stop — boundary-checked to avoid matching M50, M51, etc.
    [GeneratedRegex(@"(?:^|[^A-Z])M0*5(?:[^0-9]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex SpindleStopRegex();

    // M98 subprogram call — optional space between M98 and P, leading zeros allowed
    [GeneratedRegex(@"(?:^|[^A-Z])M0*98\s*P0*(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex M98Regex();

    // N-number prefix: N123
    [GeneratedRegex(@"^N\d+\s*", RegexOptions.IgnoreCase)]
    private static partial Regex NNumberRegex();

    // Rapid move detection: G0 or G00 (with boundary to avoid G09 etc.)
    [GeneratedRegex(@"(?:^|[^A-Z])G0*0(?:[^0-9]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex RapidMoveRegex();

    // Feed move detection: G1/G2/G3 or G01/G02/G03
    [GeneratedRegex(@"(?:^|[^A-Z])G0*[123](?:[^0-9]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex FeedMoveRegex();

    // Feed rate in command: F1234.5
    [GeneratedRegex(@"F([+-]?\d*\.?\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex FeedRateRegex();

    // Jog command: $J=
    [GeneratedRegex(@"^\$J=", RegexOptions.IgnoreCase)]
    private static partial Regex JogCommandRegex();

    // Firmware setting: $123=value
    [GeneratedRegex(@"^\$(\d+)=\s*(.+)$")]
    private static partial Regex FirmwareSettingRegex();

    public static M6ParseResult ParseM6Command(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
            return new M6ParseResult(false, null);

        if (IsGcodeComment(line))
            return new M6ParseResult(false, null);

        var normalized = line.Trim().ToUpperInvariant();
        var match = M6Regex().Match(normalized);
        if (!match.Success)
            return new M6ParseResult(false, null);

        var toolStr = match.Groups[1].Success ? match.Groups[1].Value
                    : match.Groups[2].Success ? match.Groups[2].Value
                    : null;

        int? toolNumber = toolStr is not null ? int.Parse(toolStr) : null;
        return new M6ParseResult(true, toolNumber);
    }

    public static SameToolResult CheckSameToolChange(string line, int currentTool)
    {
        var m6 = ParseM6Command(line);
        if (!m6.Matched)
            return new SameToolResult(false, false, null);

        if (m6.ToolNumber is null)
            return new SameToolResult(true, false, null);

        return new SameToolResult(true, m6.ToolNumber == currentTool, m6.ToolNumber);
    }

    public static bool IsSpindleStartCommand(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        if (IsGcodeComment(line)) return false;
        return SpindleStartRegex().IsMatch(line.Trim().ToUpperInvariant());
    }

    public static bool IsSpindleStopCommand(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        if (IsGcodeComment(line)) return false;
        return SpindleStopRegex().IsMatch(line.Trim().ToUpperInvariant());
    }

    public static bool IsM98Command(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        if (IsGcodeComment(line)) return false;
        return M98Regex().IsMatch(line.Trim().ToUpperInvariant());
    }

    public static M98ParseResult ParseM98Command(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
            return new M98ParseResult(false, null);

        if (IsGcodeComment(line))
            return new M98ParseResult(false, null);

        var normalized = line.Trim().ToUpperInvariant();
        var match = M98Regex().Match(normalized);
        if (!match.Success)
            return new M98ParseResult(false, null);

        if (int.TryParse(match.Groups[1].Value, out var macroId))
            return new M98ParseResult(true, macroId);

        return new M98ParseResult(false, null);
    }

    public static bool IsGcodeComment(string line)
    {
        var trimmed = line.Trim();

        // Strip optional N-number prefix
        var withoutLineNumber = NNumberRegex().Replace(trimmed, "");

        // Semicolon comment
        if (withoutLineNumber.StartsWith(';'))
            return true;

        // Parenthetical comment — must start with ( and end with )
        if (withoutLineNumber.StartsWith('(') && withoutLineNumber.EndsWith(')'))
            return true;

        // Empty line
        if (string.IsNullOrWhiteSpace(withoutLineNumber))
            return true;

        return false;
    }

    public static string StripNNumber(string line) =>
        NNumberRegex().Replace(line, "");

    public static bool IsRapidMove(string line) =>
        RapidMoveRegex().IsMatch(line);

    public static bool IsFeedMove(string line) =>
        FeedMoveRegex().IsMatch(line);

    public static bool IsJogCommand(string line) =>
        JogCommandRegex().IsMatch(line.Trim());

    public static bool IsTlsCommand(string line) =>
        line.Trim().Equals("$TLS", StringComparison.OrdinalIgnoreCase);

    public static FirmwareSettingParseResult ParseFirmwareSetting(string line)
    {
        var match = FirmwareSettingRegex().Match(line.Trim());
        if (!match.Success)
            return new FirmwareSettingParseResult(false, null, null);

        return new FirmwareSettingParseResult(true, match.Groups[1].Value, match.Groups[2].Value);
    }

    public static FeedRateLimitResult LimitFeedRate(string command, double maxFeedRate)
    {
        var feedMatch = FeedRateRegex().Match(command);

        if (!feedMatch.Success)
        {
            // No feed rate specified — for jog commands add the limit
            if (IsJogCommand(command))
            {
                return new FeedRateLimitResult(
                    command + $" F{maxFeedRate:0.###}",
                    WasLimited: true,
                    OriginalFeedRate: null);
            }
            return new FeedRateLimitResult(command, WasLimited: false, OriginalFeedRate: null);
        }

        if (!double.TryParse(feedMatch.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var currentFeed))
            return new FeedRateLimitResult(command, WasLimited: false, OriginalFeedRate: null);

        if (currentFeed <= maxFeedRate)
            return new FeedRateLimitResult(command, WasLimited: false, OriginalFeedRate: currentFeed);

        var limitedCommand = FeedRateRegex().Replace(command, string.Format(CultureInfo.InvariantCulture, "F{0:0.###}", maxFeedRate));
        return new FeedRateLimitResult(limitedCommand, WasLimited: true, OriginalFeedRate: Math.Round(currentFeed));
    }

    public static string ClampFeedRate(string line, double maxFeed)
    {
        var result = LimitFeedRate(line, maxFeed);
        return result.Command;
    }
}

public record M6ParseResult(bool Matched, int? ToolNumber);
public record SameToolResult(bool IsM6, bool IsSameTool, int? ToolNumber);
public record M98ParseResult(bool Matched, int? MacroId);
public record FirmwareSettingParseResult(bool Matched, string? SettingId, string? Value);
public record FeedRateLimitResult(string Command, bool WasLimited, double? OriginalFeedRate);
