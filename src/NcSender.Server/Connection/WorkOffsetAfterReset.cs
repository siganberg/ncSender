namespace NcSender.Server.Connection;

/// <summary>
/// A soft reset (Stop, or 0x18) puts grblHAL's parser back to G54, G21 and
/// G90 (gc_init; only an M2/M30 program end keeps the work offset). An
/// operator working in G55..G59 is then quietly in G54, and the next job or
/// jog runs from G54's zero. This notices that and says when to offer the
/// old offset back: a controller restart in the middle of a connection, the
/// offset in use then was G55..G59, and within a few seconds the controller
/// reports G54. Only G54: a startup block ($N0=G56) that picks another
/// offset is the operator's own choice. A fresh connection has no "before".
/// Units and distance mode are left at the reset's G21 and G90: the safe,
/// predictable state after a Stop.
/// </summary>
public sealed class WorkOffsetAfterReset
{
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(10);

    private bool _sawStatus;
    private string? _before;
    private DateTime _until;

    /// <summary>A new connection: nothing from before it counts.</summary>
    public void Connected()
    {
        _sawStatus = false;
        _before = null;
    }

    /// <summary>A status report arrived on this connection.</summary>
    public void StatusSeen() => _sawStatus = true;

    /// <summary>The controller printed its greeting: it restarted.</summary>
    public void ControllerRestarted(string? workspace, DateTime now)
    {
        if (!_sawStatus || workspace is null || workspace == "G54" || !IsWorkOffset(workspace)) return;
        _before = workspace;
        _until = now + Window;
    }

    /// <summary>
    /// The work offset the controller reports now. Returns the offset to
    /// offer back (once), or null.
    /// </summary>
    public string? Changed(string? workspace, DateTime now)
    {
        if (_before is null) return null;
        if (now > _until) { _before = null; return null; }
        if (workspace != "G54") return null;
        var was = _before;
        _before = null;
        return was;
    }

    private static bool IsWorkOffset(string w) =>
        w.Length == 3 && w[0] == 'G' && w[1] == '5' && w[2] >= '4' && w[2] <= '9';
}
