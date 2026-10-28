using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Protocols.Grbl;

/// <summary>
/// Runs grblHAL-style lines on classic Grbl 1.1, which has no expressions,
/// parameters, o-words, M6 or I/O codes, and only takes 79 characters a line.
/// <list type="bullet">
/// <item>Expressions and parameters are worked out here and sent as plain numbers.
/// Probe results, offsets and modal state come from what Grbl reports.</item>
/// <item>o-word IF/ELSEIF/ELSE/ENDIF run here: lines in a branch not taken are never sent.</item>
/// <item>(MSG, …) comments are reported as Grbl would if it echoed them, so
/// tool change sentinels and pause dialogs keep working.</item>
/// <item>M6 becomes a pause asking the operator to load the tool, M61 becomes a T word.</item>
/// <item>Codes Grbl can't run fail here with a reason, instead of a bare error:20 from Grbl.</item>
/// </list>
/// </summary>
public sealed partial class GrblTranslator : IGcodeTranslator, INgcParameters
{
    public const int MaxLineLength = 79;

    private readonly Func<MachineState> _state;
    private readonly Dictionary<int, double> _numbered = [];
    private readonly Dictionary<string, double> _named = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<Branch> _branches = [];

    // Modal state as of the last line translated. Seeded from Grbl's $G report.
    private bool _metric = true;
    private bool _absolute = true;
    private int _coordSystem = 1;
    private double _feed;
    private int _tool;
    // G43.1 offset in mm (Grbl clears it on reset).
    private double _tlo;            // mm
    private bool _restoreTlo;       // reset cleared Grbl's G43.1; resend it
    private bool _reportInches;     // $13=1: positions, offsets and feed come in inches
    private bool _parserSeen;       // a [GC:] report came in since the last reset
    private bool _maskTlo;          // reports lack the offset until the restore lands
    private double? _wcoZ;          // last WCO.Z with the offset in it (mm)
    private bool _parserAsked;      // $G sent for it

    private readonly double[] _probe = new double[3];
    private bool _probeOk;

    // Offsets come from $# (parsed into MachineState). After a line that
    // changes them, the next read asks for $# again first.
    private bool _offsetsStale = true;
    private bool _drained;   // G4 P0 sent, $# next
    // A line was rejected after its modal words were already counted.
    private bool _modalStale;
    // Pin states come from status reports; one older than the last reply may
    // predate the moves before it (a sensor check after G4 P0).
    private bool _statusStale = true;

    private sealed class Branch(string label, bool parentSkipping, bool active)
    {
        public string Label { get; } = label;
        public bool ParentSkipping { get; } = parentSkipping;
        public bool Active { get; set; } = active;
        public bool Taken { get; set; } = active;
    }

    // Where the current tool is kept between runs (null: not kept). Grbl
    // forgets it on power-up; the tool in the spindle doesn't go anywhere.
    private readonly string? _toolFile;

    public GrblTranslator(Func<MachineState> state, string? toolFile = null)
    {
        _toolFile = toolFile;
        _state = state;
        var s = state();
        // Units, distance mode and feed start at Grbl's defaults; the $G
        // sent on connect seeds them from the reply.
        _coordSystem = CoordIndex(s.Workspace) ?? 1;
        _tool = LoadTool() ?? s.Tool;
    }

    private int? LoadTool()
    {
        try
        {
            return _toolFile is not null && File.Exists(_toolFile)
                && int.TryParse(File.ReadAllText(_toolFile).Trim(), out var t) && t >= 0 ? t : null;
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    private void SetTool(int tool)
    {
        if (tool == _tool) return;
        _tool = tool;
        if (_toolFile is null) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_toolFile)!);
            File.WriteAllText(_toolFile, tool.ToString(CultureInfo.InvariantCulture));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    // Grbl doesn't keep the tool: it takes it from each line's T word (a line
    // without one reads back as T0) and a reset clears it. ncSender keeps the
    // last T it sent, through resets too (the tool in the spindle doesn't
    // change), and reports that in the parser state.
    //
    // With $13=1 Grbl reports positions, offsets, probe results and feed in
    // inches; everything in ncSender reads them as mm, so they are converted
    // here (the DRO otherwise moves 1/25.4 of the real distance).
    public string CorrectReport(string line)
    {
        if (line.StartsWith("[GC:", StringComparison.Ordinal) && line.EndsWith(']'))
            return GcToolPattern().Replace(line, $"T{_tool}");
        if (line.StartsWith('<') && line.EndsWith('>'))
        {
            if (!_reportInches && !_maskTlo) { NoteWco(line); return line; }
            var fields = line[1..^1].Split('|');
            if (_reportInches)
            {
                for (var i = 1; i < fields.Length; i++)
                {
                    var colon = fields[i].IndexOf(':');
                    if (colon < 0) continue;
                    var key = fields[i][..colon];
                    var values = fields[i][(colon + 1)..];
                    fields[i] = key switch
                    {
                        "MPos" or "WPos" or "WCO" => $"{key}:{ToMm(values, int.MaxValue)}",
                        "FS" or "F" => $"{key}:{ToMm(values, 1)}",   // feed only, not the spindle speed
                        _ => fields[i],
                    };
                }
            }
            if (_maskTlo) MaskLostTlo(fields);
            var corrected = "<" + string.Join('|', fields) + ">";
            NoteWco(corrected);
            return corrected;
        }
        if (!_reportInches) return line;
        if (OffsetReportPattern().Match(line) is { Success: true } m)
            return $"[{m.Groups[1].Value}:{ToMm(m.Groups[2].Value, int.MaxValue)}{m.Groups[3].Value}]";
        return line;
    }

    // Between a reset and the G43.1 that puts the tool length offset back, Grbl
    // reports Z without it, and the DRO and visualizer jump away and back.
    // Until its own report includes the offset again, add it here.
    // WCO = workspace + G92 + TLO, so without it WCO.Z is short by the offset
    // and WPos.Z (MPos - WCO) long by it. MPos is the real position: untouched.
    private void MaskLostTlo(string[] fields)
    {
        var wco = Array.FindIndex(fields, f => f.StartsWith("WCO:", StringComparison.Ordinal));
        if (wco >= 0)
        {
            var z = AxisValue(fields[wco], 2);
            if (z is null || _wcoZ is null || Math.Abs(z.Value - _wcoZ.Value) < 0.002)
            {
                _maskTlo = false;   // the offset is back (or the report says something else)
                return;
            }
            if (Math.Abs(z.Value + _tlo - _wcoZ.Value) >= 0.002)
            {
                _maskTlo = false;   // the offsets changed some other way: report them as they are
                return;
            }
            fields[wco] = ShiftAxis(fields[wco], 2, _tlo);
        }
        var wpos = Array.FindIndex(fields, f => f.StartsWith("WPos:", StringComparison.Ordinal));
        if (wpos >= 0) fields[wpos] = ShiftAxis(fields[wpos], 2, -_tlo);
    }

    // The last WCO.Z reported with the offset in it, in mm.
    private void NoteWco(string status)
    {
        if (_maskTlo) return;
        var start = status.IndexOf("|WCO:", StringComparison.Ordinal);
        if (start < 0) return;
        var end = status.IndexOfAny(['|', '>'], start + 5);
        if (end < 0) return;
        _wcoZ = AxisValue(status[(start + 1)..end], 2);
    }

    private static double? AxisValue(string field, int axis)
    {
        var parts = field[(field.IndexOf(':') + 1)..].Split(',');
        return axis < parts.Length && double.TryParse(parts[axis], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    private static string ShiftAxis(string field, int axis, double by)
    {
        var colon = field.IndexOf(':');
        var parts = field[(colon + 1)..].Split(',');
        if (axis < parts.Length && double.TryParse(parts[axis], NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
            parts[axis] = (v + by).ToString("0.000", CultureInfo.InvariantCulture);
        return field[..(colon + 1)] + string.Join(',', parts);
    }

    // The first `count` comma-separated values, inches to mm.
    private static string ToMm(string values, int count)
    {
        var parts = values.Split(',');
        for (var i = 0; i < parts.Length && i < count; i++)
            if (double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
                parts[i] = (v * 25.4).ToString("0.000", CultureInfo.InvariantCulture);
        return string.Join(',', parts);
    }

    // [PRB:x,y,z:1], [G54:x,y,z] .. [G59:], [G28:], [G30:], [G92:], [TLO:z].
    [GeneratedRegex(@"^\[(PRB|G5[4-9]|G28|G30|G92|TLO):([-0-9.,]+)(:[01])?\]$")]
    private static partial Regex OffsetReportPattern();

    [GeneratedRegex(@"(?<=[\[: ])T\d+(?=[ \]])")]
    private static partial Regex GcToolPattern();

    [GeneratedRegex(@"^(N\d+\s*)?M0*[789]\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex CoolantOnlyPattern();

    // $13 from the $$ reply, or as the Firmware tab writes it.
    [GeneratedRegex(@"^\$13\s*=\s*(\d+)")]
    private static partial Regex ReportInchesPattern();

    private bool Skipping => _branches.Any(b => !b.Active || b.ParentSkipping);

    public TranslationResult Translate(string line)
    {
        var src = line.Trim();
        // A job numbers every line, so the program delimiter arrives as "N1 %".
        if (src.Length == 0 || NcSender.Core.Utils.GcodePatterns.StripNNumber(src).Trim() == "%") return TranslationResult.Nothing;

        // Not into an alarm (Grbl rejects G-code there): it goes back on the
        // first line after $H or $X. Not on a coolant line either: those skip
        // the queue, which is what runs the sync.
        if (_restoreTlo && !_state().Status.StartsWith("Alarm", StringComparison.OrdinalIgnoreCase)
            && !CoolantOnlyPattern().IsMatch(src))
        {
            // In the units Grbl is in now, so only once its [GC:] report has
            // actually come in: an "ok" left over from the reset can answer
            // the $G before the report does.
            if (_parserSeen)
            {
                _restoreTlo = false;
                if (_tlo != 0) return TranslationResult.Sync($"G43.1 Z{Fmt(_tlo * UnitScale)}");
            }
            else if (!_parserAsked)
            {
                _parserAsked = true;
                _modalStale = false;
                return TranslationResult.Sync("$G");
            }
        }

        if (src[0] == '$')
        {
            if (Skipping) return TranslationResult.Nothing;
            if (ReportInchesPattern().Match(src) is { Success: true } inches)
                _reportInches = inches.Groups[1].Value != "0";
            // grblHAL's named-parameter queries. Grbl can't answer them; the one
            // ncSender relies on (is a tool length offset active) is known here.
            if (src.StartsWith("$#=", StringComparison.Ordinal))
            {
                return src[3..].Trim().Equals("_tool_offset", StringComparison.OrdinalIgnoreCase)
                    ? TranslationResult.Run(TranslationStep.Report($"[PARAM:_TOOL_OFFSET={(_tlo != 0 ? 1 : 0)}]"))
                    : TranslationResult.Nothing;
            }
            if (src.StartsWith("$J=", StringComparison.OrdinalIgnoreCase))
            {
                var jog = ClampJog(src);
                return jog is null ? TranslationResult.Nothing : TranslationResult.Run(TranslationStep.Line(jog));
            }
            return TranslationResult.Run(TranslationStep.Line(src));
        }

        string code;
        List<string> messages;
        try { (code, messages) = SplitComments(src); }
        catch (NgcException ex) { return TranslationResult.Failed(ex.Message); }

        try
        {
            if (OWordPattern().IsMatch(code)) return Flow(code);
            if (Skipping) return TranslationResult.Nothing;

            // Not on a coolant line: those skip the queue, which runs the sync.
            if (_modalStale && code.Length > 0 && !CoolantOnlyPattern().IsMatch(src))
            {
                _modalStale = false;
                return TranslationResult.Sync("$G");
            }

            var steps = new List<TranslationStep>();
            foreach (var m in messages) steps.Add(TranslationStep.Report($"[MSG:{m}]"));
            if (code.Length == 0) return new TranslationResult(TranslationKind.Run, steps);

            var parsed = Parse(code);
            // M61 sets the tool as Grbl reads the line, ahead of the moves
            // still queued before it (the bit disappeared before the machine
            // even left for the manual tool change). Let them finish first.
            if (parsed.Words.Any(w => Is(w, 'M', 61))) steps.Add(TranslationStep.Line("G4 P0"));
            var lines = Rewrite(parsed.Words, out var pauseTool);
            foreach (var l in lines)
            {
                var written = Format(l);
                if (written.Error is { } error) return TranslationResult.Failed(error);
                steps.Add(TranslationStep.Line(written.Line!));
            }
            if (pauseTool is { } tool)
            {
                steps.Add(TranslationStep.Report($"[MSG:NCSENDER_PAUSE: Tool change | Load tool T{tool}, then press Continue.]"));
                steps.Add(TranslationStep.Line("M0"));
            }

            // Assignments take effect after the line's words were read (LinuxCNC rule).
            foreach (var (target, value) in parsed.Assignments) Assign(target, value);
            foreach (var l in lines) Track(l);
            return new TranslationResult(TranslationKind.Run, steps);
        }
        catch (OffsetsNeeded)
        {
            // Grbl answers $# only when Idle (error:8 while a move is still
            // running), so let queued motion finish first.
            if (!_drained)
            {
                _drained = true;
                return TranslationResult.Sync("G4 P0");
            }
            _drained = false;
            _offsetsStale = false;
            return TranslationResult.Sync("$#");
        }
        catch (StatusNeeded)
        {
            return TranslationResult.Sync("?");
        }
        catch (NgcException ex)
        {
            return TranslationResult.Failed(ex.Message);
        }
    }

    public void ObserveData(string line)
    {
        if (ReportInchesPattern().Match(line) is { Success: true } inches)
        {
            _reportInches = inches.Groups[1].Value != "0";
            return;
        }
        if (line.StartsWith('<'))
        {
            _statusStale = false;
            return;
        }
        if (line == "ok" || line.StartsWith("error:", StringComparison.Ordinal))
        {
            _statusStale = true;
            return;
        }
        if (line.StartsWith("[PRB:", StringComparison.Ordinal) && line.EndsWith(']'))
        {
            // [PRB:x,y,z:1] machine coordinates in mm, then whether it touched.
            var body = line[5..^1];
            var colon = body.LastIndexOf(':');
            if (colon < 0) return;
            var coords = body[..colon].Split(',');
            for (var i = 0; i < 3 && i < coords.Length; i++)
                _probe[i] = double.TryParse(coords[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
            _probeOk = body[(colon + 1)..].Trim() == "1";
        }
        else if (line.StartsWith("[GC:", StringComparison.Ordinal) && line.EndsWith(']'))
        {
            _parserSeen = true;
            foreach (var mode in line[4..^1].Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                switch (mode)
                {
                    case "G20": _metric = false; break;
                    case "G21": _metric = true; break;
                    case "G90": _absolute = true; break;
                    case "G91": _absolute = false; break;
                    default:
                        // Not the T in it: Grbl sets its tool from each line's
                        // T word, so any line without one reads back as T0.
                        // The tool is the last T ncSender sent (CorrectReport).
                        if (CoordIndex(mode) is { } cs) _coordSystem = cs;
                        else if (mode.Length > 1 && mode[0] == 'F'
                                 && double.TryParse(mode[1..], NumberStyles.Float, CultureInfo.InvariantCulture, out var f)) _feed = f;
                        break;
                }
            }
        }
    }

    public void OnLineFailed()
    {
        _branches.Clear();
        _drained = false;
        _modalStale = true;
        _offsetsStale = true;
    }

    public void Reset()
    {
        // Grbl's gc_init(): G21 G90 G54, no feed, no tool length offset. The
        // tool stays (see CorrectReport), and so does the offset: the tool in
        // the spindle is still the one measured, so it goes back to Grbl
        // before the next line (grblHAL keeps it through a reset).
        _branches.Clear();
        _drained = false;
        _metric = true;
        _absolute = true;
        _coordSystem = 1;
        _feed = 0;
        _restoreTlo = _tlo != 0;
        _maskTlo = _restoreTlo && _wcoZ is not null;
        _parserSeen = false;
        _parserAsked = false;
        // The startup lines ($N0/$N1) run after a reset and can change any of
        // that (a G20 there leaves Grbl in inches), so read the parser state
        // back before the next line rather than assume it.
        _modalStale = true;
        _offsetsStale = true;
    }

    // ---- comments ----

    // Grbl strips comments itself, but '!', '~' and '?' inside one still act
    // as realtime commands (feed hold!), so they never go out.
    private static (string Code, List<string> Messages) SplitComments(string src)
    {
        var code = new StringBuilder();
        var messages = new List<string>();
        for (var i = 0; i < src.Length; i++)
        {
            var c = src[i];
            if (c == ';') break;
            if (c != '(') { code.Append(c); continue; }
            var end = src.IndexOf(')', i + 1);
            if (end < 0) throw new NgcException("comment has no closing ')'");
            var comment = src[(i + 1)..end];
            var msg = MsgPattern().Match(comment);
            if (msg.Success) messages.Add(msg.Groups[1].Value.Trim());
            i = end;
        }
        return (code.ToString().Trim(), messages);
    }

    // ---- o-words ----

    private TranslationResult Flow(string code)
    {
        var m = OWordPattern().Match(code);
        var label = m.Groups[1].Value.ToLowerInvariant().TrimStart('0');
        var keyword = m.Groups[2].Value.ToLowerInvariant();
        var rest = code[m.Length..];

        Branch Top()
        {
            if (_branches.Count == 0 || _branches[^1].Label != label)
                throw new NgcException($"o{label} {keyword} has no matching o{label} if");
            return _branches[^1];
        }

        switch (keyword)
        {
            case "if":
                if (Skipping) _branches.Add(new Branch(label, parentSkipping: true, active: false));
                else _branches.Add(new Branch(label, parentSkipping: false, active: Condition(rest)));
                break;
            case "elseif":
            {
                var b = Top();
                if (b.ParentSkipping) break;
                if (b.Taken) b.Active = false;
                else { b.Active = Condition(rest); b.Taken = b.Active; }
                break;
            }
            case "else":
            {
                var b = Top();
                if (b.ParentSkipping) break;
                b.Active = !b.Taken;
                b.Taken = true;
                break;
            }
            case "endif":
                Top();
                _branches.RemoveAt(_branches.Count - 1);
                break;
            default:
                if (Skipping) break;
                throw new NgcException($"o-word '{keyword}' isn't supported on Grbl yet");
        }
        return TranslationResult.Nothing;
    }

    private bool Condition(string rest)
    {
        var reader = new NgcReader(rest, this);
        if (reader.Peek() != '[') throw new NgcException("o-word condition must be in [brackets]");
        var value = reader.ReadRealValue();
        if (!reader.AtEnd) throw new NgcException($"unexpected '{reader.Rest.Trim()}' after the condition");
        return value != 0;
    }

    // ---- words ----

    // Continuous jog asks for the axis's whole travel and relies on the
    // controller to stop at the soft limit, as grblHAL does. Grbl instead
    // rejects a jog that would end past it (error:15), so with soft limits on
    // an incremental jog is shortened to end inside the travel: machine
    // positions run from -max travel to 0. Grbl checks this homed or not (an
    // unlock with $X keeps it on), so the clamp goes by $20; before $$ has
    // been read, by homed. Null when nothing is left to move.
    private string? ClampJog(string line)
    {
        var s = _state();
        if (!(s.SoftLimits ?? s.Homed)) return line;
        var body = line[3..];
        if (!JogIncrementalPattern().IsMatch(body)) return line;

        var mpos = s.MPos.Split(',');
        var travel = new[] { s.MaxTravelX, s.MaxTravelY, s.MaxTravelZ };
        var scale = JogInchPattern().IsMatch(body) ? 25.4 : 1.0;
        var moving = false;
        var clamped = JogAxisPattern().Replace(body, m =>
        {
            var axis = char.ToUpperInvariant(m.Groups[1].Value[0]) - 'X';
            if (axis >= mpos.Length || travel[axis] <= 0
                || !double.TryParse(mpos[axis], NumberStyles.Float, CultureInfo.InvariantCulture, out var pos)
                || !double.TryParse(m.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var dist))
            {
                moving = true;
                return m.Value;
            }
            // Not in the -travel..0 layout (a build that homes to positive
            // space): leave the jog to the controller.
            if (pos > 0.001 || pos < -travel[axis] - 0.001)
            {
                moving = true;
                return m.Value;
            }
            const double margin = 0.01;
            var target = Math.Clamp(pos + dist * scale, -travel[axis] + margin, -margin);
            var allowed = (target - pos) / scale;
            // Already at the limit (or inside the margin): no move that way.
            if (Math.Abs(allowed) < 0.001 || Math.Sign(allowed) != Math.Sign(dist)) return "";
            moving = true;
            return m.Groups[1].Value + allowed.ToString("0.###", CultureInfo.InvariantCulture);
        });
        return moving ? "$J=" + Regex.Replace(clamped.Trim(), @"\s{2,}", " ") : null;
    }

    [GeneratedRegex(@"\bG91\b", RegexOptions.IgnoreCase)]
    private static partial Regex JogIncrementalPattern();

    [GeneratedRegex(@"\bG20\b", RegexOptions.IgnoreCase)]
    private static partial Regex JogInchPattern();

    [GeneratedRegex(@"\b([XYZ])\s*([-+]?\d*\.?\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex JogAxisPattern();

    private sealed record Word(char Letter, double Value, string? Literal);
    private sealed record ParsedLine(List<Word> Words, List<(NgcParamRef Target, double Value)> Assignments);

    private ParsedLine Parse(string code)
    {
        var reader = new NgcReader(code, this);
        var words = new List<Word>();
        var assignments = new List<(NgcParamRef, double)>();
        while (!reader.AtEnd)
        {
            var c = reader.Peek();
            if (c == '#')
            {
                var target = reader.ReadParameterRef();
                reader.Expect('=');
                assignments.Add((target, reader.ReadRealValue()));
                continue;
            }
            if (!char.IsLetter(c)) throw new NgcException($"unexpected '{c}' in '{code}'");
            var letter = char.ToUpperInvariant(reader.Next());
            var value = reader.ReadRealValue(out var literal);
            words.Add(new Word(letter, value, literal));
        }
        return new ParsedLine(words, assignments);
    }

    private static bool Is(Word w, char letter, double code) => w.Letter == letter && Math.Abs(w.Value - code) < 0.001;

    // The lines a source line becomes on Grbl, or why it can't run.
    private List<List<Word>> Rewrite(List<Word> words, out int? pauseTool)
    {
        pauseTool = null;
        var line = new List<Word>(words);

        foreach (var w in words)
        {
            if (w.Letter == 'M' && w.Value is >= 62 and < 69)
                throw new NgcException($"M{Fmt(w.Value)} needs controller I/O, which Grbl doesn't have");
            if (Is(w, 'M', 51) || Is(w, 'M', 48) || Is(w, 'M', 49) || Is(w, 'M', 50) || Is(w, 'M', 53))
                throw new NgcException($"M{Fmt(w.Value)} (override control) isn't supported on Grbl");
            if (Is(w, 'G', 43))
                throw new NgcException("G43 (tool table offset) isn't supported on Grbl; use G43.1");
            if (Is(w, 'G', 10) && words.FirstOrDefault(x => x.Letter == 'L') is { } l && l.Value is not (2 or 20))
                throw new NgcException($"G10 L{Fmt(l.Value)} (tool table) isn't supported on Grbl");
            if (w.Letter == 'G' && w.Value is > 59 and < 60)
                throw new NgcException($"G{Fmt(w.Value)} isn't available on Grbl (G54-G59 only)");
        }

        // G65 P5 Qn picks the probe input on grblHAL; Grbl has one probe.
        // G65 P6 skips grblHAL's wait for the spindle to reach speed (tool
        // changer plugins send it around their spin-on moves); Grbl never
        // waits, so there is nothing to skip.
        if (words.Any(w => Is(w, 'G', 65)))
        {
            if (words.Any(w => Is(w, 'P', 5) || Is(w, 'P', 6)))
            {
                line.RemoveAll(w => Is(w, 'G', 65) || w.Letter is 'P' or 'Q');
            }
            else throw new NgcException("G65 (macro call) isn't supported on Grbl");
        }

        // M61 Qn: set the current tool without a change. Grbl's T word does that.
        if (line.FirstOrDefault(w => Is(w, 'M', 61)) is { } m61)
        {
            var q = line.FirstOrDefault(w => w.Letter == 'Q') ?? throw new NgcException("M61 needs a Q word");
            line.Remove(m61);
            line.Remove(q);
            line.RemoveAll(w => w.Letter == 'T');
            line.Add(new Word('T', Math.Round(q.Value), null));
        }

        // M6: Grbl has no tool change. Keep the T word, then pause for the operator.
        if (line.FirstOrDefault(w => Is(w, 'M', 6)) is { } m6)
        {
            line.Remove(m6);
            pauseTool = line.LastOrDefault(w => w.Letter == 'T') is { } t ? (int)Math.Round(t.Value) : _tool;
        }

        return line.Count == 0 ? [] : [line];
    }

    private (string? Line, string? Error) Format(List<Word> words)
    {
        string Build(IEnumerable<Word> ws, string separator) =>
            string.Join(separator, ws.Select(w => $"{w.Letter}{w.Literal ?? Fmt(w.Value)}"));

        // Grbl drops spaces before counting, so the limit applies to the packed line.
        var packed = Build(words, "");
        if (packed.Length > MaxLineLength)
        {
            // A line number is only for display; a long line can do without it.
            var withoutN = words.Where(w => w.Letter != 'N').ToList();
            packed = Build(withoutN, "");
            if (packed.Length > MaxLineLength)
                return (null, $"line is {packed.Length} characters, Grbl takes at most {MaxLineLength}");
            return (packed, null);
        }
        var spaced = Build(words, " ");
        return (spaced.Length <= MaxLineLength ? spaced : packed, null);
    }

    private string Fmt(double v)
    {
        var rounded = Math.Round(v, _metric ? 4 : 5);
        if (rounded == 0) rounded = 0; // no "-0"
        return rounded.ToString(_metric ? "0.####" : "0.#####", CultureInfo.InvariantCulture);
    }

    private void Track(List<Word> words)
    {
        foreach (var w in words)
        {
            switch (w.Letter)
            {
                case 'G':
                    if (Is(w, 'G', 20)) _metric = false;
                    else if (Is(w, 'G', 21)) _metric = true;
                    else if (Is(w, 'G', 90)) _absolute = true;
                    else if (Is(w, 'G', 91)) _absolute = false;
                    else if (Is(w, 'G', 10) || Is(w, 'G', 92) || Is(w, 'G', 92.1) || Is(w, 'G', 43.1) || Is(w, 'G', 49))
                    {
                        _offsetsStale = true;
                        // Offsets set anew: report them as Grbl does.
                        _maskTlo = false;
                        if (Is(w, 'G', 49) || Is(w, 'G', 43.1)) _restoreTlo = false;
                        if (Is(w, 'G', 49)) _tlo = 0;
                        else if (Is(w, 'G', 43.1))
                            _tlo = (words.FirstOrDefault(x => x.Letter == 'Z')?.Value ?? 0) / UnitScale;
                    }
                    else if (w.Value is >= 54 and <= 59 && Math.Abs(w.Value - Math.Round(w.Value)) < 0.001)
                        _coordSystem = (int)Math.Round(w.Value) - 53;
                    break;
                case 'F': _feed = w.Value; break;
                case 'T': SetTool((int)Math.Round(w.Value)); break;
                case 'M':
                    if (Is(w, 'M', 2) || Is(w, 'M', 30)) { _absolute = true; _coordSystem = 1; }
                    break;
            }
        }
    }

    // ---- parameters ----

    private sealed class OffsetsNeeded : Exception;
    private sealed class StatusNeeded : Exception;

    private MachineState FreshStatus()
    {
        if (_statusStale) throw new StatusNeeded();
        return _state();
    }

    private double UnitScale => _metric ? 1 : 1 / 25.4;

    private double[] CoordOffset(int system)
    {
        if (_offsetsStale) throw new OffsetsNeeded();
        var s = _state();
        var raw = system switch { 1 => s.G54, 2 => s.G55, 3 => s.G56, 4 => s.G57, 5 => s.G58, 6 => s.G59, _ => null };
        return ParseTriple(raw);
    }

    private static double[] ParseTriple(string? raw)
    {
        var result = new double[3];
        if (string.IsNullOrEmpty(raw)) return result;
        var parts = raw.Split(',');
        for (var i = 0; i < 3 && i < parts.Length; i++)
            double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out result[i]);
        return result;
    }

    public double Get(int number)
    {
        switch (number)
        {
            case >= 1 and <= 5000:
                return _numbered.GetValueOrDefault(number);
            case >= 5061 and <= 5069:
            {
                // The last probe point in the coordinate system in use (grblHAL's #5061-#5069).
                var axis = number - 5061;
                if (axis >= 3) return 0;
                return (_probe[axis] - CoordOffset(_coordSystem)[axis]) * UnitScale;
            }
            case 5070:
                return _probeOk ? 1 : 0;
            case >= 5211 and <= 5219:
            {
                var axis = number - 5211;
                if (_offsetsStale) throw new OffsetsNeeded();
                return axis < 3 ? ParseTriple(_state().G92Offset)[axis] * UnitScale : 0;
            }
            case 5220:
                return _coordSystem;
            case >= 5221 and <= 5340:
            {
                var system = (number - 5221) / 20 + 1;
                var axis = (number - 5221) % 20;
                return axis < 3 ? CoordOffset(system)[axis] * UnitScale : 0;
            }
            case 5400:
                return _tool;
            case >= 5420 and <= 5428:
                throw new NgcException($"#{number} (current position) isn't available on Grbl yet");
            default:
                throw new NgcException($"parameter #{number} isn't available on Grbl");
        }
    }

    private double? SystemValue(string name) => name.ToLowerInvariant() switch
    {
        "_metric" => _metric ? 1 : 0,
        "_imperial" => _metric ? 0 : 1,
        "_absolute" => _absolute ? 1 : 0,
        "_incremental" => _absolute ? 0 : 1,
        "_feed" => _feed,
        "_current_tool" => _tool,
        "_coord_system" => 530 + _coordSystem * 10,
        "_probe_state" => FreshStatus().Pn.Contains('P') ? 1 : 0,
        // Classic Grbl has no tool setter input.
        "_toolsetter_state" => 0,
        "_speed_override" => throw new NgcException("#<_speed_override> needs override control (M51), which Grbl doesn't have"),
        _ => null,
    };

    public double GetNamed(string name)
    {
        if (SystemValue(name) is { } value) return value;
        if (_named.TryGetValue(name, out var stored)) return stored;
        throw new NgcException($"#<{name}> is not set");
    }

    public bool ExistsNamed(string name) => _named.ContainsKey(name) || IsSystemName(name);

    private static bool IsSystemName(string name) => name.ToLowerInvariant() is
        "_metric" or "_imperial" or "_absolute" or "_incremental" or "_feed" or "_current_tool"
        or "_coord_system" or "_probe_state" or "_toolsetter_state" or "_speed_override";

    private void Assign(NgcParamRef target, double value)
    {
        if (target.Name is { } name)
        {
            if (IsSystemName(name)) throw new NgcException($"#<{name}> is read-only");
            _named[name] = value;
        }
        else if (target.Number is >= 1 and <= 5000)
        {
            _numbered[target.Number.Value] = value;
        }
        else
        {
            throw new NgcException($"#{target.Number} is read-only");
        }
    }

    private static int? CoordIndex(string? mode) => mode switch
    {
        "G54" => 1, "G55" => 2, "G56" => 3, "G57" => 4, "G58" => 5, "G59" => 6, _ => null,
    };

    [GeneratedRegex(@"^\s*o\s*(\d+|<[^>]+>)\s*([a-z]+)", RegexOptions.IgnoreCase)]
    private static partial Regex OWordPattern();

    [GeneratedRegex(@"^\s*MSG\s*[,:]\s*(.*)$", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex MsgPattern();
}
