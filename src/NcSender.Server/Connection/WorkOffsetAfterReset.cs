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
/// and within 10 s the controller reports G54. A $G reply after the event
/// that still says G55..G59 (grblHAL set to keep the offset at M30, or a
/// startup block) ends it: a G54 picked later is the operator's own. Only
/// G54: a startup block ($N0=G56) picking another offset is theirs too.
/// Units and distance mode are left at the reset's G21 and G90.
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

    /// <summary>
    /// A $G reply arrived on this connection (workspace: its G54..G59): the
    /// offset shown is the controller's. One that isn't G54 after an event
    /// means the event didn't drop it.
    /// </summary>
    public void Confirmed(string? workspace)
    {
        lock (_lock)
        {
            _known = true;
            if (_before is not null && workspace is not null && workspace != "G54") _before = null;
        }
    }

    /// <summary>
    /// Something that puts the parser back to G54: a reset (ncSender sent
    /// 0x18, or the controller greeted mid-session) or a program end. Both
    /// a 0x18 and a greeting can come for one reset; the first, with the
    /// offset before it, counts. why: said in the question. True when it's
    /// now watching (the caller reads $G then, to see where it went).
    /// </summary>
    public bool Dropped(string? workspace, DateTime now, string why)
    {
        lock (_lock)
        {
            if (!_known || (_before is not null && now <= _until)) return false;
            if (workspace is null || workspace == "G54" || !IsWorkOffset(workspace)) return false;
            _before = workspace;
            _why = why;
            _until = now + Window;
            return true;
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

    /// <summary>A program end's message: grblHAL's and Grbl's, or FluidNC's.</summary>
    public static bool IsProgramEnd(string line)
    {
        var t = line.Trim();
        return t.Equals("[MSG:Pgm End]", StringComparison.OrdinalIgnoreCase)
            || t.StartsWith("[MSG:INFO: Program End", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The work offset (G54..G59) in a $G reply, "[GC:G0 G55 G17 ...]", or null.</summary>
    public static string? WorkOffsetIn(string gcReply)
    {
        foreach (var word in gcReply.Trim('[', ']', ' ').Split(' ', ':'))
            if (IsWorkOffset(word)) return word;
        return null;
    }

    private static bool IsWorkOffset(string w) =>
        w.Length == 3 && w[0] == 'G' && w[1] == '5' && w[2] >= '4' && w[2] <= '9';
}
