using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Protocols.FluidNc;

/// <summary>
/// Runs ncSender's grblHAL lines on FluidNC and reports FluidNC as grblHAL.
/// FluidNC already runs expressions, named and numbered parameters, o-word
/// IF/ELSE and M62-M66, so most lines go out as written. What differs:
/// <list type="bullet">
/// <item>Sent: no M51 (override control) or G65 P6, no $EA/$EE/$ES lists or
/// $pinstate, no $#=name query, and no minus straight before a bracket.</item>
/// <item>Reported: no H: field, no measured spindle speed in FS (it streams
/// the VFD's reading as a message instead), (MSG, ...) comments echoed as
/// [MSG:INFO: MSG, ...], alarms listed as "N: text", and the line number of
/// the run before a reset kept until a new line runs.</item>
/// <item>A reset stops FluidNC applying the tool length offset (grblHAL
/// keeps it), though its $# still lists it. It goes back before the next
/// line, so the measured tool stays measured, as on grblHAL.</item>
/// </list>
/// </summary>
public sealed partial class FluidNcTranslator : IGcodeTranslator
{
    // Measured spindle speed drain after M5, per status report (~200 ms):
    // FluidNC stops streaming the VFD's reading before the spindle has stopped,
    // so the gauge would stick at the last one. 0.6 takes 6000 rpm to 0 in ~2 s.
    private const double SpindleCoastDownFactor = 0.6;
    private const double SpindleCoastDownFloorRpm = 50;
    private const double Epsilon = 0.0005;

    private readonly object _lock = new();

    private bool _alarm;

    private double _commandedRpm;
    private double _measuredRpm;

    private int _lastLn;
    private int? _staleLn;

    private bool _alarmList;

    // ---- tool length offset ----
    //
    // FluidNC's [TLO:] is the offset last set (G43.1) or cleared (G49), and a
    // reset doesn't change it: it is the offset grblHAL would still apply.
    // FluidNC itself stops applying it at a reset (its WCO goes without it),
    // so after one it is read back with $# and set again with G43.1.
    private double _tloZ;
    private int _tloReports;
    private int? _tloReportsAtSync;
    // G43.1 since the last G49 or reset: a zero offset is still one in effect.
    private bool _offsetApplied;

    // ncSender resets the controller as it connects, so a new translator
    // starts just after one.
    private bool _afterReset = true;
    private bool _parserSeen;
    private bool _parserAsked;
    private int? _tloReportsAtReset = 0;
    private bool _restoring;
    private bool _metric = true;

    // Between a reset and the G43.1 that puts the offset back, FluidNC's WCO
    // lacks it: the same offset is added to the reported WCO, until FluidNC's
    // own has it again (_wcoZWithTlo: the WCO.Z that had it in).
    private double? _wcoZ;
    private double? _maskTlo;
    private double? _wcoZWithTlo;

    public TranslationResult Translate(string line)
    {
        lock (_lock)
        {
            _restoring = false;
            if (RestoreTloFirst(line) is { } restore) return restore;
        }

        // Most job lines: nothing to change. Every rewrite below needs one of these.
        if (line.IndexOf('$') < 0 && line.IndexOf('[') < 0
            && line.IndexOf('M', StringComparison.OrdinalIgnoreCase) < 0
            && line.IndexOf('G', StringComparison.OrdinalIgnoreCase) < 0)
            return Pass(line);

        var code = CodeOf(line);
        if (code.Length == 0) return Pass(line);

        if (code[0] == '$') return TranslateSystem(code) ?? Pass(line);

        lock (_lock)
        {
            if (G43Pattern().IsMatch(code)) _offsetApplied = true;
            if (G49Pattern().IsMatch(code)) _offsetApplied = false;
        }

        var rewritten = line;

        // Override control is grblHAL's. FluidNC's spindle override stays
        // with the operator; the tool change runs at whatever it is set to.
        if (M51Pattern().IsMatch(code))
        {
            code = M51Pattern().Replace(code, "").Trim();
            if (code.Length == 0) return TranslationResult.Nothing;
            rewritten = code;
        }

        // G65 P6 skips grblHAL's spindle at-speed wait; FluidNC has none to skip.
        // Any other G65 is a grblHAL macro FluidNC can't call.
        if (G65Pattern().Match(code) is { Success: true } g65)
        {
            if (g65.Groups[1].Value != "6")
                return TranslationResult.Failed("FluidNC can't run G65 macros");
            code = G65Pattern().Replace(code, "").Trim();
            if (code.Length == 0) return TranslationResult.Nothing;
            rewritten = code;
        }

        // FluidNC rejects a word followed by a minus and a bracket ("X-[...]");
        // the same value with the minus inside the brackets runs.
        if (rewritten.Contains("-[", StringComparison.Ordinal))
            rewritten = MoveMinusInside(rewritten);

        return Pass(rewritten);
    }

    // After a reset, before the next line: the units ($G), the offset ($#),
    // then G43.1 with it. Not into an alarm (FluidNC rejects G-code there): it
    // goes back on the first line after it clears. Not on a coolant or aux
    // line either: those skip the queue, which is what runs the sync.
    private TranslationResult? RestoreTloFirst(string line)
    {
        if (!_afterReset || _alarm || OutOfBandPattern().IsMatch(line.Trim())) return null;
        if (!_parserSeen)
        {
            if (_parserAsked) return null;
            _parserAsked = true;
            return TranslationResult.Sync("$G");
        }
        if (_tloReportsAtReset == _tloReports)
        {
            _tloReportsAtReset = null;   // asked once; if no [TLO:] came, nothing to put back
            return TranslationResult.Sync("$#");
        }
        _afterReset = false;
        _tloReportsAtReset = null;
        if (Math.Abs(_tloZ) <= Epsilon) return null;
        _restoring = true;
        _offsetApplied = true;
        var value = _metric ? _tloZ : _tloZ / 25.4;
        return TranslationResult.Sync($"G43.1 Z{value.ToString("0.####", CultureInfo.InvariantCulture)}");
    }

    private TranslationResult? TranslateSystem(string code)
    {
        var upper = code.ToUpperInvariant();
        switch (upper)
        {
            case "$EA":
                lock (_lock) _alarmList = true;
                return Pass("$A");
            case "$EE" or "$EG" or "$ES" or "$ESH" or "$PINSTATE":
                return TranslationResult.Nothing;
        }

        if (!upper.StartsWith("$#=", StringComparison.Ordinal)) return null;
        var name = code[3..].Trim();
        if (name.Length == 0) return null;

        if (name.Equals("_tool_offset", StringComparison.OrdinalIgnoreCase))
        {
            lock (_lock)
            {
                // Read the offset fresh ($#) and answer from it.
                if (_tloReportsAtSync is not { } before)
                {
                    _tloReportsAtSync = _tloReports;
                    return TranslationResult.Sync("$#");
                }
                _tloReportsAtSync = null;
                var applied = _tloReports != before && (Math.Abs(_tloZ) > Epsilon || _offsetApplied);
                return TranslationResult.Run(TranslationStep.Report($"[PARAM:_TOOL_OFFSET={(applied ? 1 : 0)}]"));
            }
        }

        // Any other parameter: FluidNC prints it, and the print comes back as
        // grblHAL's [PARAM:] (CorrectReport).
        string reference;
        if (name.All(char.IsDigit)) reference = "#" + name;
        else if (ParamNamePattern().IsMatch(name)) reference = $"#<{name}>";
        else return null;
        return Pass($"(PRINT, {ParamPrintTag} {name}={reference})");
    }

    private const string ParamPrintTag = "NCSENDER_PARAM";

    public void ObserveData(string line)
    {
        if (!line.StartsWith('[') || !line.EndsWith(']'))
        {
            if (line == "ok" || line.StartsWith("error:", StringComparison.Ordinal))
                lock (_lock) _alarmList = false;
            return;
        }

        lock (_lock)
        {
            if (line.StartsWith("[TLO:", StringComparison.Ordinal))
            {
                // [TLO:x,y,z] (FluidNC lists every axis) or [TLO:z].
                _tloZ = Z(line[5..^1]) ?? 0;
                _tloReports++;
            }
            else if (line.StartsWith("[GC:", StringComparison.Ordinal))
            {
                _parserSeen = true;
                foreach (var mode in line[4..^1].Split(' ', StringSplitOptions.RemoveEmptyEntries))
                {
                    if (mode == "G20") _metric = false;
                    else if (mode == "G21") _metric = true;
                }
            }
        }
    }

    public void OnLineFailed()
    {
        lock (_lock)
        {
            _tloReportsAtSync = null;
            _alarmList = false;
            // The G43.1 that put the offset back didn't run: try again next line.
            if (_restoring)
            {
                _restoring = false;
                _afterReset = true;
                _tloReportsAtReset = _tloReports;
            }
        }
    }

    public void Reset()
    {
        lock (_lock)
        {
            _tloReportsAtSync = null;
            _alarmList = false;
            // FluidNC keeps reporting the last line number after a reset.
            if (_lastLn > 0) _staleLn = _lastLn;

            // Hold the DRO on the offset that was in effect, until it is back.
            if (_offsetApplied || Math.Abs(_tloZ) > Epsilon)
            {
                _maskTlo = _tloZ;
                _wcoZWithTlo = _wcoZ;
            }
            _afterReset = true;
            _tloReportsAtReset = _tloReports;
            _offsetApplied = false;
            _restoring = false;
            _parserSeen = false;
            _parserAsked = false;
            _metric = true;
        }
    }

    public string? CorrectReport(string line)
    {
        if (line.StartsWith('<') && line.EndsWith('>')) return CorrectStatus(line);

        if (line.StartsWith("[MSG:INFO:", StringComparison.Ordinal))
        {
            var measured = MeasuredSpeedPattern().Match(line);
            if (measured.Success)
            {
                lock (_lock)
                {
                    // After M5 the VFD sends a few coast-down readings before it
                    // stops; the drain in CorrectStatus covers that, so the gauge
                    // doesn't flick back up.
                    if (_commandedRpm > 0
                        && double.TryParse(measured.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var rpm))
                        _measuredRpm = rpm;
                }
                return null;
            }
            // "Syncing to N" / "Synced speed to N" are the VFD's own units, not rpm.
            if (SpindleSyncPattern().IsMatch(line)) return null;

            var echoed = EchoedMessagePattern().Match(line);
            if (echoed.Success) return $"[MSG:{echoed.Groups[1].Value.Trim()}]";

            var param = ParamPrintPattern().Match(line);
            if (param.Success)
            {
                var value = double.TryParse(param.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)
                    ? v.ToString("0.000", CultureInfo.InvariantCulture)
                    : param.Groups[2].Value.Trim();
                return $"[PARAM:{param.Groups[1].Value.Trim()}={value}]";
            }
            return line;
        }

        lock (_lock)
        {
            if (_alarmList && AlarmListPattern().Match(line) is { Success: true } alarm)
                return $"[ALARMCODE:{alarm.Groups[1].Value}||{alarm.Groups[2].Value.Trim()}]";
        }
        return line;
    }

    private string CorrectStatus(string line)
    {
        var fields = line[1..^1].Split('|').ToList();
        lock (_lock)
        {
            _alarm = fields[0].StartsWith("Alarm", StringComparison.OrdinalIgnoreCase);
            var hasHomed = false;
            for (var i = 1; i < fields.Count; i++)
            {
                var field = fields[i];
                if (field.StartsWith("H:", StringComparison.Ordinal)) hasHomed = true;
                else if (field.StartsWith("FS:", StringComparison.Ordinal))
                {
                    var parts = field[3..].Split(',');
                    if (parts.Length >= 2
                        && double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var commanded))
                        _commandedRpm = commanded;
                    if (_commandedRpm <= 0 && _measuredRpm > 0)
                    {
                        var drained = _measuredRpm * SpindleCoastDownFactor;
                        _measuredRpm = drained < SpindleCoastDownFloorRpm ? 0 : Math.Round(drained);
                    }
                    if (parts.Length == 2)
                        fields[i] = $"FS:{parts[0]},{parts[1]},{_measuredRpm.ToString("0", CultureInfo.InvariantCulture)}";
                }
                else if (field.StartsWith("Ln:", StringComparison.Ordinal) && int.TryParse(field[3..], out var ln))
                {
                    if (_staleLn == ln)
                    {
                        fields.RemoveAt(i--);
                        continue;
                    }
                    _staleLn = null;
                    _lastLn = ln;
                }
                else if (field.StartsWith("WCO:", StringComparison.Ordinal))
                    fields[i] = CorrectWco(field);
            }
            // FluidNC has no homed flag; homing is up to the operator, so the
            // machine reads as homed (nothing waits for a homing cycle).
            if (!hasHomed) fields.Add("H:1");
        }
        return "<" + string.Join('|', fields) + ">";
    }

    private string CorrectWco(string field)
    {
        var z = Z(field[4..]);
        if (z is null) return field;
        if (_maskTlo is { } tlo && _wcoZWithTlo is { } before)
        {
            if (Math.Abs(z.Value - before) >= 0.002 && Math.Abs(z.Value + tlo - before) < 0.002)
                return ShiftZ(field, tlo);
            // The offset is back, or the offsets changed some other way: as reported.
            _maskTlo = null;
            _wcoZWithTlo = null;
        }
        _wcoZ = z;
        return field;
    }

    private static double? Z(string values)
    {
        var parts = values.Split(',');
        var z = parts.Length >= 3 ? parts[2] : parts[^1];
        return double.TryParse(z, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    private static string ShiftZ(string field, double by)
    {
        var colon = field.IndexOf(':');
        var parts = field[(colon + 1)..].Split(',');
        if (parts.Length >= 3 && double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
            parts[2] = (v + by).ToString("0.000", CultureInfo.InvariantCulture);
        return field[..(colon + 1)] + string.Join(',', parts);
    }

    private static TranslationResult Pass(string line) => TranslationResult.Run(TranslationStep.Line(line));

    // The line without its comments, trimmed.
    private static string CodeOf(string line)
    {
        if (line.IndexOf('(') < 0 && line.IndexOf(';') < 0) return line.Trim();
        var sb = new StringBuilder(line.Length);
        var depth = 0;
        foreach (var c in line)
        {
            if (c == ';' && depth == 0) break;
            if (c == '(') { depth++; continue; }
            if (c == ')' && depth > 0) { depth--; continue; }
            if (depth == 0) sb.Append(c);
        }
        return sb.ToString().Trim();
    }

    // "X-[a+b]" -> "X[-[a+b]]", outside comments.
    internal static string MoveMinusInside(string line)
    {
        var sb = new StringBuilder(line.Length + 4);
        var comment = 0;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (c == '(') comment++;
            else if (c == ')' && comment > 0) comment--;
            if (comment == 0 && c == '-' && i + 1 < line.Length && line[i + 1] == '['
                && i > 0 && char.IsLetter(line[i - 1]))
            {
                var close = MatchingBracket(line, i + 1);
                if (close > 0)
                {
                    sb.Append("[-").Append(line, i + 1, close - i).Append(']');
                    i = close;
                    continue;
                }
            }
            sb.Append(c);
        }
        return sb.ToString();
    }

    private static int MatchingBracket(string line, int open)
    {
        var depth = 0;
        for (var i = open; i < line.Length; i++)
        {
            if (line[i] == '[') depth++;
            else if (line[i] == ']' && --depth == 0) return i;
        }
        return -1;
    }

    [GeneratedRegex(@"M0*51(?!\d)\s*(P\s*(\[[^\]]*\]+|[-+]?[\d.]+))?", RegexOptions.IgnoreCase)]
    private static partial Regex M51Pattern();

    [GeneratedRegex(@"G65(?![\d.])\s*P\s*(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex G65Pattern();

    [GeneratedRegex(@"G43\.1(?!\d)", RegexOptions.IgnoreCase)]
    private static partial Regex G43Pattern();

    [GeneratedRegex(@"G49(?![\d.])", RegexOptions.IgnoreCase)]
    private static partial Regex G49Pattern();

    // Coolant and aux output lines go out ahead of the queue.
    [GeneratedRegex(@"^(N\d+\s*)?M0*(7|8|9|6[2-5])(?!\d)", RegexOptions.IgnoreCase)]
    private static partial Regex OutOfBandPattern();

    [GeneratedRegex(@"^_?[A-Za-z][A-Za-z0-9_]*$")]
    private static partial Regex ParamNamePattern();

    [GeneratedRegex(@"^\[MSG:INFO:\s*Current speed is\s+(\d+)\s*\]$", RegexOptions.IgnoreCase)]
    private static partial Regex MeasuredSpeedPattern();

    [GeneratedRegex(@"^\[MSG:INFO:\s*(?:Syncing to|Synced speed to)\b", RegexOptions.IgnoreCase)]
    private static partial Regex SpindleSyncPattern();

    // (MSG, text) comments: grblHAL reports [MSG:text].
    [GeneratedRegex(@"^\[MSG:INFO:\s*MSG,\s*(.*)\]$", RegexOptions.IgnoreCase)]
    private static partial Regex EchoedMessagePattern();

    [GeneratedRegex(@"^\[MSG:INFO:\s*PRINT,\s*" + ParamPrintTag + @"\s+([^=\]]+)=([^\]]*)\]$", RegexOptions.IgnoreCase)]
    private static partial Regex ParamPrintPattern();

    // $A: "2: Soft Limit".
    [GeneratedRegex(@"^(\d+):\s*(.+)$")]
    private static partial Regex AlarmListPattern();
}
