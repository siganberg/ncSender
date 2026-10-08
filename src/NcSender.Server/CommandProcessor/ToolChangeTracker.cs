using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.CommandProcessor;

/// <inheritdoc />
public sealed class ToolChangeTracker : IToolChangeTracker
{
    // Registered sequences not started yet. Ones that never start (skipped
    // after an error, flushed by a reset) are dropped once this many newer
    // ones exist.
    private const int MaxPending = 32;

    private readonly ILogger<ToolChangeTracker> _logger;
    private readonly object _gate = new();
    private readonly Dictionary<int, ToolChangeInfo> _pending = new();
    private int _nextId;
    private (int Id, ToolChangeInfo Info)? _active;
    private bool _lengthInDoubt;

    // Lines that leave the tool length unknown: clearing it, measuring, or a
    // bare M6 / G65 call handing over to a controller macro ncSender can't see.
    private static readonly Regex DoubtLine = new(
        @"G43(?:\.1)?(?!\d)|G49(?!\d)|G38\.[2-5]|^\$TLS|M0*6(?!\d)|G65(?!\d)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    // A G43.1 that applies a real length (a stored value, or the result of a
    // measurement that just finished) settles it again.
    private static readonly Regex SettleLine = new(
        @"G43\.1Z(\[|[-+]?[\d.]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static bool Settles(string code)
    {
        var m = SettleLine.Match(code);
        if (!m.Success) return false;
        var z = m.Groups[1].Value;
        return z == "[" || (double.TryParse(z, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var v) && v != 0);
    }
    private static readonly Regex Comments = new(@"\([^)]*\)|;.*$", RegexOptions.Compiled);

    public event Action<ToolChangeEvent>? Started;
    public event Action<ToolChangeEvent>? Ended;

    public ToolChangeTracker(ICncController controller, ILogger<ToolChangeTracker> logger)
    {
        _logger = logger;
        controller.DataReceived += (data, _) => OnData(data);
        controller.CommandAcknowledged += OnAcknowledged;
        controller.ErrorReceived += e => { if (e.Code == "ALARM") Abort("alarm"); };
        controller.StopReceived += () => { Abort("stopped"); ClearPending(); };
        controller.ConnectionStatusChanged += (_, connected) => { if (!connected) { Abort("disconnected"); ClearPending(); } };
    }

    public int Register(ToolChangeInfo info)
    {
        lock (_gate)
        {
            var id = ++_nextId;
            _pending[id] = info;
            if (_pending.Count > MaxPending)
                _pending.Remove(_pending.Keys.Min());
            return id;
        }
    }

    private void OnData(string data)
    {
        if (!data.StartsWith("[MSG", StringComparison.OrdinalIgnoreCase)
            || !ToolChangeSentinel.TryParse(data, out var kind, out var id) || id == 0)
            return;

        ToolChangeEvent? started = null, ended = null;
        lock (_gate)
        {
            if (kind == "START")
            {
                // A sequence can carry its own M6/$TLS (a plugin's $TLS),
                // bracketed again inside the outer one: only the outermost
                // change is reported.
                if (_pending.Remove(id, out var info) && _active is null)
                {
                    _active = (id, info);
                    _lengthInDoubt = false;
                    started = new ToolChangeEvent(info);
                }
            }
            else if (_active is { } a && a.Id == id)
            {
                _active = null;
                ended = new ToolChangeEvent(a.Info, "completed", null, _lengthInDoubt);
            }
        }
        Raise(Started, started, "start");
        Raise(Ended, ended, "completed");
    }

    // A rejected line stops the sequence (ExpandedCommandSender, job
    // streaming). Jogs are excluded: one refused by the controller doesn't
    // touch the sequence.
    private void OnAcknowledged(CommandResult result)
    {
        if (result.Status is "success" or "error" && result.Command is { } line)
        {
            var code = Comments.Replace(line, "").Replace(" ", "");
            // A rejected line changed nothing, except a probe: a failed probe
            // still means the measurement didn't finish.
            var settles = result.Status == "success" && Settles(code);
            var doubts = !settles && DoubtLine.IsMatch(code);
            if (settles || doubts)
                lock (_gate) if (_active is not null) _lengthInDoubt = doubts;
        }
        if (result.Status != "error") return;
        if (result.Command?.TrimStart().StartsWith("$J=", StringComparison.OrdinalIgnoreCase) == true) return;
        Abort("error");
    }

    private void Abort(string reason)
    {
        ToolChangeEvent? ended = null;
        lock (_gate)
        {
            if (_active is { } a)
            {
                _active = null;
                ended = new ToolChangeEvent(a.Info, "aborted", reason, _lengthInDoubt);
            }
        }
        Raise(Ended, ended, "aborted (" + reason + ")");
    }

    private void ClearPending()
    {
        lock (_gate) _pending.Clear();
    }

    private void Raise(Action<ToolChangeEvent>? handler, ToolChangeEvent? e, string what)
    {
        if (e is null) return;
        _logger.LogInformation("Tool change {What}: {Kind} T{Tool} (from T{Previous})", what, e.Info.Kind, e.Info.Tool, e.Info.PreviousTool);
        try { handler?.Invoke(e); }
        catch (Exception ex) { _logger.LogError(ex, "Tool change event handler failed"); }
    }
}
