namespace NcSender.Server.Connection;

/// <summary>
/// Shared line framing for controller transports. Each byte-level transport
/// (serial, TCP, WebSocket) reads raw bytes into a <see cref="System.Text.StringBuilder"/>,
/// splits at the last '\n' so partial lines survive across reads, then hands
/// each complete line to <see cref="CollectLineWithStatusSplice"/> to extract
/// any inline &lt;…&gt; status report that a '?' realtime poll may have
/// spliced into the middle of a longer response.
///
/// The naive alternative — a char-by-char state machine that treats any '&lt;'
/// as the start of a status report — got burned by grblHAL PINSTATE labels
/// that legitimately contain '&lt;-' (e.g. "P3 &lt;- Laser enable"). One stray
/// '&lt;' would swallow the rest of the burst (PINSTATE lines, 'ok's, tool
/// tables, coord offsets) into a single phantom "status" buffer that only
/// closed at some distant '&gt;'. Symptoms downstream: firmware queries
/// timing out because their 'ok' was buried inside the phantom status;
/// machine state getting set to a bogus first-'|'-field like
/// "- Spindle at speed"; user commands stuck behind the wedged queue.
/// See <see cref="SerialTransport"/> comments — that path was fixed first;
/// this helper exists so TCP and WebSocket can't drift back to the broken
/// behaviour.
/// </summary>
internal static class TransportLineFramer
{
    /// <summary>
    /// Emit <paramref name="line"/> to <paramref name="sink"/> as one or more
    /// items, extracting any single inline &lt;…&gt; status frame. Splits into
    /// up to three pieces per level: prefix, status frame, suffix — recursing
    /// into the suffix so back-to-back inline statuses are all handled.
    /// Lines without a properly-paired &lt;…&gt; are emitted verbatim, so a
    /// PINSTATE label with '&lt;-' but no closing '&gt;' passes through intact.
    /// </summary>
    public static void CollectLineWithStatusSplice(string line, List<string> sink)
    {
        var lt = line.IndexOf('<');
        var gt = lt >= 0 ? line.IndexOf('>', lt + 1) : -1;
        if (lt < 0 || gt <= lt)
        {
            sink.Add(line);
            return;
        }

        if (lt > 0)
        {
            var prefix = line[..lt].TrimEnd();
            if (prefix.Length > 0)
                sink.Add(prefix);
        }

        sink.Add(line.Substring(lt, gt - lt + 1));

        if (gt + 1 < line.Length)
        {
            var suffix = line[(gt + 1)..].TrimStart();
            if (suffix.Length > 0)
                CollectLineWithStatusSplice(suffix, sink);
        }
    }
}
