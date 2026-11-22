namespace NcSender.Server.Connection;

/// <summary>
/// A soft reset (Stop, or 0x18) puts grblHAL's parser back to G54, G21 and
/// G90 (gc_init), and a program end (M2/M30) puts the work offset back to
/// G54 too (LinuxCNC's convention; grblHAL can be set not to). An operator
/// working in G55..G59 is then quietly in G54, and the next job (the same
/// one, run again) or jog runs from G54's zero. This notices that and says
/// when to offer the old offset back: a reset (one ncSender sent, or a
/// greeting from the controller restarting) or a program end while the
/// offset in use, known from a $G reply on this connection, was G55..G59,
/// and within a few seconds the controller reports G54. Only G54: a startup block ($N0=G56) that picks another
/// offset is the operator's own choice. Units and distance mode are left at
/// the reset's G21 and G90: the safe, predictable state after a Stop.
/// </summary>
public sealed class WorkOffsetAfterReset
{
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(10);

    private readonly object _lock = new();
    private bool _known;
    private string? _before;
    private string _why = "";
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
    /// Something that puts the parser back to G54: a reset (ncSender sent
    /// 0x18, or the controller greeted mid-session) or a program end. Both
    /// a 0x18 and a greeting can come for one reset; the first, with the
    /// offset before it, counts. why: said in the question.
    /// </summary>
    public void Dropped(string? workspace, DateTime now, string why)
    {
        lock (_lock)
        {
            if (!_known || (_before is not null && now <= _until)) return;
            if (workspace is null || workspace == "G54" || !IsWorkOffset(workspace)) return;
            _before = workspace;
            _why = why;
            _until = now + Window;
        }
    }

    /// <summary>
    /// The work offset the controller reports now. Returns the offset to
    /// offer back (once) and why it changed, or null.
    /// </summary>
    public (string Was, string Why)? Changed(string? workspace, DateTime now)
    {
        lock (_lock)
        {
            if (_before is null) return null;
            if (now > _until) { _before = null; return null; }
            if (workspace != "G54") return null;
            var was = _before;
            _before = null;
            return (was, _why);
        }
    }

    private static bool IsWorkOffset(string w) =>
        w.Length == 3 && w[0] == 'G' && w[1] == '5' && w[2] >= '4' && w[2] <= '9';
}
