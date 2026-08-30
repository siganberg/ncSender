using System.Collections.Concurrent;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Dongle;

/// <summary>
/// Generic tracker for "@name"-addressed ESP-NOW devices relayed by the dongle. It owns no
/// device-specific logic: for each device it records presence (a line seen within
/// <see cref="ConnectedWindowMs"/> = connected) and the raw last payload, and rebroadcasts
/// raw messages to WS clients. Accessory plugins interpret the payloads.
///
/// Traffic arrives on the pendant/dongle serial connection; <see cref="PendantManager"/>
/// forwards "@…" lines to <see cref="OnDongleLine"/>. A watchdog broadcasts the disconnect
/// transition when a device's traffic stops.
/// </summary>
public sealed class DongleDeviceService : IDongleDeviceService, IDisposable
{
    // A linked device heartbeats a few times/sec, so tolerate several lost lines (the ESP-NOW
    // dongle link is lossy and can occasionally drop a newline) before declaring it gone.
    private const long ConnectedWindowMs = 6000;

    private sealed class DeviceState
    {
        public long LastSeenTicks;      // Environment.TickCount64 of last line, 0 = never
        public string? LastMessage;
        public bool WasConnected;
        public long LastBroadcastTicks;
    }

    private readonly ILogger<DongleDeviceService> _logger;
    private readonly IBroadcaster _broadcaster;
    private readonly Timer _watchdog;
    private readonly ConcurrentDictionary<string, DeviceState> _devices = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Mirrors <see cref="DongleOtaService.SelfDeviceName"/>.</summary>
    private const string SelfDeviceName = "wireless-usb";

    private Func<string, Task>? _sender;
    private bool _enumerated;

    // Names reported by the enumeration currently in flight. Reconciling against
    // this at "$DEVICES:END" is what lets a swap drop the old dongle's devices
    // without a reattach of the SAME dongle emptying the list on the way past.
    private readonly HashSet<string> _seen = new(StringComparer.OrdinalIgnoreCase);
    private bool _enumerating;

    public event Action<string, string>? DeviceMessageReceived;
    public event Action<string, bool>? DeviceConnectivityChanged;

    public DongleDeviceService(ILogger<DongleDeviceService> logger, IBroadcaster broadcaster)
    {
        _logger = logger;
        _broadcaster = broadcaster;
        _watchdog = new Timer(_ => CheckDisconnects(), null, 1000, 1000);
    }

    public void SetSender(Func<string, Task>? sender) => _sender = sender;

    public IReadOnlyList<DongleDeviceInfo> GetDevices()
    {
        var now = Environment.TickCount64;
        var list = new List<DongleDeviceInfo>(_devices.Count);
        foreach (var kv in _devices)
            list.Add(Snapshot(kv.Key, kv.Value, now));
        return list;
    }

    public DongleDeviceInfo? GetDevice(string name)
        => _devices.TryGetValue(name, out var st) ? Snapshot(name, st, Environment.TickCount64) : null;

    private static DongleDeviceInfo Snapshot(string name, DeviceState st, long now)
    {
        var last = st.LastSeenTicks;
        var sinceMs = last == 0 ? -1 : now - last;
        return new DongleDeviceInfo
        {
            Name = name,
            Connected = last != 0 && sinceMs >= 0 && sinceMs < ConnectedWindowMs,
            LastSeenMs = sinceMs,
            LastMessage = st.LastMessage
        };
    }

    // Line looks like: "@autodustboot status pos=123 …" — everything after "@name " is the raw payload.
    // Also accepts "$DEVICES:<name>" replies (seed the paired list on dongle attach), which
    // populate a "known but never seen" entry so the plugin can distinguish a paired-but-
    // offline device from an unpaired one after a server restart.
    public void OnDongleLine(string line)
    {
        if (string.IsNullOrEmpty(line)) return;

        // "$DEVICES:<name>" — dongle reply enumerating currently-paired devices.
        // Bare "$DEVICES:" (or "$DEVICES:END") is a terminator, no seeding needed.
        // The multi-device dongle firmware sends one line per active peer.
        const string devicesPrefix = "$DEVICES:";
        if (line.StartsWith(devicesPrefix, StringComparison.Ordinal))
        {
            var seedName = line.Substring(devicesPrefix.Length).Trim();
            // The dongle always sends the terminator, even with zero peers, so
            // this - not a non-empty list - is what proves it answered us.
            if (seedName.Equals("END", StringComparison.Ordinal))
            {
                FinishEnumeration();
                Volatile.Write(ref _enumerated, true);
                return;
            }
            if (seedName.Length > 0 && IsValidDeviceName(seedName))
            {
                // Seed with LastSeenTicks = 0 so Snapshot() reports Connected=false /
                // LastSeenMs=-1 — the plugin sees "paired but offline" until the device
                // actually sends a message.
                lock (_seen) { if (_enumerating) _seen.Add(seedName); }
                _devices.GetOrAdd(seedName, _ => new DeviceState());
                _logger.LogInformation("Seeded paired device '{Name}' from dongle $DEVICES reply", seedName);
                _ = _broadcaster.Broadcast("dongle:device-changed",
                    new DongleDeviceChanged { Name = seedName, Connected = false },
                    NcSenderJsonContext.Default.DongleDeviceChanged);
            }
            return;
        }

        // An untagged "$OTA:ACK" is the dongle answering about its OWN update.
        // Everything else it says untagged is either a command reply (handled by
        // whoever asked) or pendant traffic, so only the ack is claimed here.
        if (line.StartsWith("$OTA:ACK ", StringComparison.Ordinal))
        {
            DeviceMessageReceived?.Invoke(SelfDeviceName, line);
            return;
        }

        if (line[0] != '@') return;
        var sp = line.IndexOf(' ');
        if (sp < 2) return;                          // need at least "@x "
        var name = line.Substring(1, sp - 1);
        var payload = line.Substring(sp + 1);

        // Guard against corrupted framing on the lossy serial link (e.g. a dropped newline
        // merging a fragment into the next line -> "@auto@autodustboot …"). Only accept sane
        // device names; drop the garbled line and wait for the next clean heartbeat.
        if (!IsValidDeviceName(name)) return;

        var st = _devices.GetOrAdd(name, _ => new DeviceState());
        bool justConnected;
        long now = Environment.TickCount64;
        lock (st)
        {
            justConnected = !st.WasConnected || st.LastSeenTicks == 0 || (now - st.LastSeenTicks) >= ConnectedWindowMs;
            st.LastSeenTicks = now;
            st.LastMessage = payload;
            st.WasConnected = true;
        }

        // Per-message hook for latency-sensitive consumers (e.g. XProbeTranslator)
        // that need every payload immediately — the WS relay below is throttled.
        try { DeviceMessageReceived?.Invoke(name, payload); }
        catch (Exception ex) { _logger.LogWarning(ex, "DeviceMessageReceived handler threw for '{Name}'", name); }

        // Relay every raw message (throttled ~1/sec) so plugins can react; always emit the
        // connect edge immediately, and emit a device-changed edge on (re)connect.
        if (justConnected)
        {
            _ = _broadcaster.Broadcast("dongle:device-changed",
                new DongleDeviceChanged { Name = name, Connected = true },
                NcSenderJsonContext.Default.DongleDeviceChanged);
            try { DeviceConnectivityChanged?.Invoke(name, true); }
            catch (Exception ex) { _logger.LogWarning(ex, "DeviceConnectivityChanged handler threw for '{Name}'", name); }
        }
        long lastBc;
        lock (st) lastBc = st.LastBroadcastTicks;
        if (justConnected || now - lastBc >= 1000)
        {
            lock (st) st.LastBroadcastTicks = now;
            _ = _broadcaster.Broadcast("dongle:device-message",
                new DongleDeviceMessage { Name = name, Payload = payload },
                NcSenderJsonContext.Default.DongleDeviceMessage);
        }
    }

    // Accept only [A-Za-z0-9_-], 1-32 chars — enough for real device names, rejects garbled framing.
    private static bool IsValidDeviceName(string name)
    {
        if (name.Length is 0 or > 32) return false;
        foreach (var c in name)
        {
            var ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
            if (!ok) return false;
        }
        return true;
    }

    private void CheckDisconnects()
    {
        long now = Environment.TickCount64;
        foreach (var kv in _devices)
        {
            var st = kv.Value;
            bool transitioned;
            lock (st)
            {
                var last = st.LastSeenTicks;
                var sinceMs = last == 0 ? -1 : now - last;
                var connected = last != 0 && sinceMs >= 0 && sinceMs < ConnectedWindowMs;
                transitioned = st.WasConnected && !connected;
                if (transitioned) st.WasConnected = false;
            }
            if (transitioned)
            {
                _logger.LogDebug("Dongle device '{Name}' disconnected (no traffic > {Ms}ms)", kv.Key, ConnectedWindowMs);
                _ = _broadcaster.Broadcast("dongle:device-changed",
                    new DongleDeviceChanged { Name = kv.Key, Connected = false },
                    NcSenderJsonContext.Default.DongleDeviceChanged);
                try { DeviceConnectivityChanged?.Invoke(kv.Key, false); }
                catch (Exception ex) { _logger.LogWarning(ex, "DeviceConnectivityChanged handler threw for '{Name}'", kv.Key); }
            }
        }
    }

    public Task SendAsync(string name, string payload)
    {
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender($"@{name} {payload}");
    }

    public Task SendRawLineAsync(string line)
    {
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender(line);
    }

    public Task OpenPairingAsync()
    {
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender("$PAIR");
    }

    // Close an open pairing window early. Ignored by older firmware that predates
    // the $PAIR:STOP command (the window then just expires on its own).
    public Task CancelPairingAsync()
    {
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender("$PAIR:STOP");
    }

    // Ask the dongle for its current paired-devices list. Reply arrives async
    // as "$DEVICES:<name>" and is handled by OnDongleLine (which seeds _devices).
    // Called on dongle attach so we know about paired-but-offline devices without
    // relying on the host's in-memory state.
    public Task RequestDevicesAsync()
    {
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender("$DEVICES");
    }

    public bool DevicesEnumerated => Volatile.Read(ref _enumerated);

    public void BeginEnumeration()
    {
        Volatile.Write(ref _enumerated, false);
        lock (_seen)
        {
            _seen.Clear();
            _enumerating = true;
        }
        // Deliberately does NOT clear here. Clearing on attach emptied the list
        // every time the dongle handler flapped — and on Windows it flaps: the
        // port drops and is reopened within milliseconds, several times a
        // session, with the same dongle on the same COM port. Each flap wiped
        // four devices out of the UI and put them back a second later. The list
        // is instead reconciled when the reply lands, so a re-attach of the same
        // dongle is invisible and only a genuine swap removes anything.
    }

    /// <summary>
    /// Drop devices the just-completed enumeration did not mention. They belong
    /// to a dongle that is no longer the one plugged in.
    /// </summary>
    private void FinishEnumeration()
    {
        string[] stale;
        lock (_seen)
        {
            if (!_enumerating) return;
            _enumerating = false;
            stale = _devices.Keys.Where(k => !_seen.Contains(k)).ToArray();
        }

        foreach (var name in stale)
        {
            if (!_devices.TryRemove(name, out _)) continue;
            _ = _broadcaster.Broadcast("dongle:device-changed",
                new DongleDeviceChanged { Name = name, Connected = false },
                NcSenderJsonContext.Default.DongleDeviceChanged);
        }
        if (stale.Length > 0)
            _logger.LogInformation("Dropped {Count} device(s) not paired to this dongle: {Names}",
                stale.Length, string.Join(", ", stale));
    }

    public Task UnpairAsync(string name)
    {
        // Drop it locally so the device list updates immediately; the dongle stops relaying it.
        if (_devices.TryRemove(name, out _))
            _ = _broadcaster.Broadcast("dongle:device-changed",
                new DongleDeviceChanged { Name = name, Connected = false },
                NcSenderJsonContext.Default.DongleDeviceChanged);
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender($"$UNPAIR {name}");
    }

    public void Dispose() => _watchdog.Dispose();
}
