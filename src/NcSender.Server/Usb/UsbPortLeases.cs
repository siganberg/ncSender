namespace NcSender.Server.Usb;

/// <summary>
/// Single source of truth for who owns a USB serial port right now.
///
/// The host keeps several long-lived readers on accessory cables — the pendant
/// port scanner holds the pendant and the dongle, the XProbe router holds the
/// XProbe. A firmware flash needs the device to itself: on Linux a second
/// <c>SerialPort</c> on the same tty opens happily, with no exclusive lock, and
/// then two read loops race for every line the device sends. The flasher's
/// BEGIN ack lands in the scanner's reader instead of its own, so the flash
/// reports "no BEGIN ack — device may be offline" while the device is sitting
/// there having answered. Which reader wins is timing, which is why the
/// symptom moved around: sometimes a dead BEGIN, sometimes a transfer that ran
/// to 100% and then failed at Update.end().
///
/// So ownership is arbitrated here rather than by hoping. An owner claims the
/// port it opens and hands back a way to close it; a flash suspends the port,
/// which closes the owner and keeps it closed until the flash is done.
/// </summary>
public sealed class UsbPortLeases
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Action> _owners = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _suspended = new(StringComparer.OrdinalIgnoreCase);

    /// Register the callback that closes this port. Called by whoever opened it.
    public void Claim(string port, Action release)
    {
        if (string.IsNullOrEmpty(port)) return;
        lock (_gate) _owners[port] = release;
    }

    public void Release(string port)
    {
        if (string.IsNullOrEmpty(port)) return;
        lock (_gate) _owners.Remove(port);
    }

    /// True while a flash owns the port. Owners must consult this before
    /// (re)opening, or the next scan tick simply undoes the suspension.
    public bool IsSuspended(string port)
    {
        if (string.IsNullOrEmpty(port)) return false;
        lock (_gate) return _suspended.Contains(port);
    }

    /// <summary>
    /// Take the port for a firmware update: mark it suspended so no owner
    /// reopens it, then close whoever holds it. Disposing releases the mark and
    /// the owner's own rescan reclaims the port.
    ///
    /// Safe to call for a port nobody owns — that is the common case for an
    /// accessory the host does not keep a reader on, and it still needs the
    /// suspension mark so a scan mid-flash cannot claim the cable underneath.
    /// </summary>
    public IDisposable SuspendForFlash(string port)
    {
        if (string.IsNullOrEmpty(port)) return new Lease(this, null);

        Action? release;
        lock (_gate)
        {
            _suspended.Add(port);
            _owners.TryGetValue(port, out release);
        }
        // Outside the lock: closing a port can block on a reader shutting down.
        try { release?.Invoke(); } catch { /* best effort — the flash still owns it */ }
        return new Lease(this, port);
    }

    private sealed class Lease : IDisposable
    {
        private UsbPortLeases? _leases;
        private readonly string? _port;
        public Lease(UsbPortLeases leases, string? port) { _leases = leases; _port = port; }
        public void Dispose()
        {
            var l = _leases; _leases = null;
            if (l is null || _port is null) return;
            lock (l._gate) l._suspended.Remove(_port);
        }
    }
}
