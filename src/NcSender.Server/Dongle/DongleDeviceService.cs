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
    private const long ConnectedWindowMs = 3000;

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

    private Func<string, Task>? _sender;

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
    public void OnDongleLine(string line)
    {
        if (string.IsNullOrEmpty(line) || line[0] != '@') return;
        var sp = line.IndexOf(' ');
        if (sp < 2) return;                          // need at least "@x "
        var name = line.Substring(1, sp - 1);
        var payload = line.Substring(sp + 1);

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

        // Relay every raw message (throttled ~1/sec) so plugins can react; always emit the
        // connect edge immediately, and emit a device-changed edge on (re)connect.
        if (justConnected)
        {
            _ = _broadcaster.Broadcast("dongle:device-changed",
                new DongleDeviceChanged { Name = name, Connected = true },
                NcSenderJsonContext.Default.DongleDeviceChanged);
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
                _logger.LogInformation("Dongle device '{Name}' disconnected (no traffic > {Ms}ms)", kv.Key, ConnectedWindowMs);
                _ = _broadcaster.Broadcast("dongle:device-changed",
                    new DongleDeviceChanged { Name = kv.Key, Connected = false },
                    NcSenderJsonContext.Default.DongleDeviceChanged);
            }
        }
    }

    public Task SendAsync(string name, string payload)
    {
        var sender = _sender;
        return sender is null ? Task.CompletedTask : sender($"@{name} {payload}");
    }

    public void Dispose() => _watchdog.Dispose();
}
