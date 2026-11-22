namespace NcSender.Server.Connection;

/// <summary>
/// A soft reset (Stop, or 0x18) puts grblHAL's parser back to G54, G21 and
/// G90 (gc_init; only an M2/M30 program end keeps the work offset). An
/// operator working in G55..G59 is then quietly in G54, and the next job or
/// jog runs from G54's zero. This notices that and says when to offer the
/// old offset back: a reset (one ncSender sent, or a greeting from the
/// controller restarting) while the offset in use, known from a $G reply on
/// this connection, was G55..G59, and within a few seconds the controller
/// reports G54. Only G54: a startup block ($N0=G56) that picks another
/// offset is the operator's own choice. Units and distance mode are left at
/// the reset's G21 and G90: the safe, predictable state after a Stop.
/// </summary>
public sealed class WorkOffsetAfterReset
{
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(10);

    private readonly object _lock = new();
    private bool _known;
    private string? _before;
    private DateTime _until;

    /// <summary>A new connection: the offset isn't known until $G says it.</summary>
    public void Connected()
    {
        lock (_lock) { _known = false; _before = null; }
    }

    /// <summary>A $G reply arrived on this connection: the offset shown is the controller's.</summary>
    public void Confirmed()
    {
        lock (_lock) _known = true;
    }

    /// <summary>
    /// A reset: ncSender sent 0x18, or the controller greeted mid-session.
    /// Both can come for one reset; the first, with the offset before it, counts.
    /// </summary>
    public void Reset(string? workspace, DateTime now)
    {
        lock (_lock)
        {
            if (!_known || (_before is not null && now <= _until)) return;
            if (workspace is null || workspace == "G54" || !IsWorkOffset(workspace)) return;
            _before = workspace;
            _until = now + Window;
        }
    }

    /// <summary>
    /// The work offset the controller reports now. Returns the offset to
    /// offer back (once), or null.
    /// </summary>
    public string? Changed(string? workspace, DateTime now)
    {
        lock (_lock)
        {
            if (_before is null) return null;
            if (now > _until) { _before = null; return null; }
            if (workspace != "G54") return null;
            var was = _before;
            _before = null;
            return was;
        }
    }

    private static bool IsWorkOffset(string w) =>
        w.Length == 3 && w[0] == 'G' && w[1] == '5' && w[2] >= '4' && w[2] <= '9';
}
