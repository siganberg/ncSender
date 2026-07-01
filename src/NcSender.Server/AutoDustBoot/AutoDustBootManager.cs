using System.Globalization;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.AutoDustBoot;

/// <summary>
/// Tracks the "autodustboot" ESP-NOW device. It pairs through the same dongle as the
/// pendant, so its traffic arrives on the pendant/dongle serial connection prefixed with
/// "@autodustboot ". <see cref="PendantManager"/> forwards those lines to
/// <see cref="OnDongleLine"/>. The device pushes a "status …" line ~2×/sec while linked,
/// so "connected" = a line seen within the last few seconds. A watchdog broadcasts the
/// disconnect transition when the traffic stops.
/// </summary>
public sealed class AutoDustBootManager : IAutoDustBootManager, IDisposable
{
    private const string DeviceName = "autodustboot";
    private const long ConnectedWindowMs = 3000;

    private readonly ILogger<AutoDustBootManager> _logger;
    private readonly IBroadcaster _broadcaster;
    private readonly Timer _watchdog;
    private readonly object _lock = new();

    private long _lastSeenTicks;   // Environment.TickCount64 of last @autodustboot line, 0 = never
    private string? _state;
    private long _pos;
    private long _saved;
    private bool _homed;
    private bool _wasConnected;

    private Func<string, Task>? _sender;

    public AutoDustBootManager(ILogger<AutoDustBootManager> logger, IBroadcaster broadcaster)
    {
        _logger = logger;
        _broadcaster = broadcaster;
        // Detect the disconnect transition (absence of traffic) once per second.
        _watchdog = new Timer(_ => CheckDisconnect(), null, 1000, 1000);
    }

    public void SetSender(Func<string, Task>? sender) => _sender = sender;

    public AutoDustBootStatus GetStatus()
    {
        lock (_lock)
        {
            var sinceMs = _lastSeenTicks == 0 ? -1 : Environment.TickCount64 - _lastSeenTicks;
            return new AutoDustBootStatus
            {
                Connected = _lastSeenTicks != 0 && sinceMs >= 0 && sinceMs < ConnectedWindowMs,
                LastSeenMs = sinceMs,
                State = _state,
                Pos = _pos,
                Saved = _saved,
                Homed = _homed
            };
        }
    }

    // Line looks like: "@autodustboot status pos=123 saved=0 state=home homed=1"
    public void OnDongleLine(string line)
    {
        var sp = line.IndexOf(' ');
        if (sp < 1) return;
        var name = line.Substring(1, sp - 1);           // drop leading '@'
        if (!string.Equals(name, DeviceName, StringComparison.OrdinalIgnoreCase)) return;

        lock (_lock)
        {
            _lastSeenTicks = Environment.TickCount64;
            _wasConnected = true;
            ParseStatus(line.Substring(sp + 1));
        }
        // Push a live update (device sends ~2×/sec while linked).
        Broadcast();
    }

    private void ParseStatus(string payload)
    {
        // "status pos=123 saved=0 state=home homed=1" — tolerant token parse
        foreach (var tok in payload.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = tok.IndexOf('=');
            if (eq <= 0) continue;
            var key = tok.Substring(0, eq);
            var val = tok.Substring(eq + 1);
            switch (key)
            {
                case "pos": long.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out _pos); break;
                case "saved": long.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out _saved); break;
                case "state": _state = val; break;
                case "homed": _homed = val is "1" || val.Equals("true", StringComparison.OrdinalIgnoreCase); break;
            }
        }
    }

    private void CheckDisconnect()
    {
        bool transitioned;
        lock (_lock)
        {
            var sinceMs = _lastSeenTicks == 0 ? -1 : Environment.TickCount64 - _lastSeenTicks;
            var connected = _lastSeenTicks != 0 && sinceMs >= 0 && sinceMs < ConnectedWindowMs;
            transitioned = _wasConnected && !connected;
            if (transitioned) _wasConnected = false;
        }
        if (transitioned)
        {
            _logger.LogInformation("AutoDustBoot disconnected (no dongle traffic > {Ms}ms)", ConnectedWindowMs);
            Broadcast();
        }
    }

    private void Broadcast() =>
        _ = _broadcaster.Broadcast("autodustboot:status-changed", GetStatus(),
                                   NcSenderJsonContext.Default.AutoDustBootStatus);

    public Task SendCommandAsync(string payload)
    {
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender($"@{DeviceName} {payload}");
    }

    public void Dispose() => _watchdog.Dispose();
}
