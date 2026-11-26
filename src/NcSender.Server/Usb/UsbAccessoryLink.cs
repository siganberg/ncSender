using System.Collections.Concurrent;
using System.IO.Ports;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Usb;

public sealed class UsbAccessoryLink : IHostedService, IDisposable
{
    private const int BaudRate = 115200;
    private const int ScanIntervalMs = 2000;

    private static readonly IReadOnlyDictionary<string, NcSenderUsbKind> Peers =
        new Dictionary<string, NcSenderUsbKind>(StringComparer.OrdinalIgnoreCase)
        {
            ["autodustboot"] = NcSenderUsbKind.AutoDustBoot,
            // Wireless I/O: same command table on its USB port, no "@xio" prefix.
            ["xio"] = NcSenderUsbKind.Xio,
        };

    private sealed class Link
    {
        public required string Peer { get; init; }
        public required string Port { get; init; }
        public required SerialPort Serial { get; init; }
        public List<byte> Rx { get; } = new(256);
        // When the device last reported its state on this link (TickCount64), 0 = never.
        public long LastStateTicks;
        public object Gate { get; } = new();
        public List<Waiter> Waiters { get; } = new();
    }

    private sealed record Waiter(Func<string, bool> Match, TaskCompletionSource<string?> Reply);

    private readonly INcSenderUsbCatalog _catalog;
    private readonly UsbPortLeases _leases;
    private readonly ILogger<UsbAccessoryLink> _logger;
    private readonly NcSender.Server.Dongle.DongleDeviceService? _devices;
    private readonly ConcurrentDictionary<string, Link> _links = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public UsbAccessoryLink(INcSenderUsbCatalog catalog, UsbPortLeases leases, IDongleDeviceService devices,
                            ILogger<UsbAccessoryLink> logger)
    {
        _devices = devices as NcSender.Server.Dongle.DongleDeviceService;
        _catalog = catalog;
        _leases = leases;
        _logger = logger;
    }

    public bool IsConnected(string peerName) =>
        _links.TryGetValue(peerName, out var link) && link.Serial.IsOpen;

    public async Task<string?> QueryAsync(string peerName, string payload, Func<string, bool> match, int timeoutMs)
    {
        if (!_links.TryGetValue(peerName, out var link)) return null;

        var waiter = new Waiter(match, new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously));
        lock (link.Gate) link.Waiters.Add(waiter);
        try
        {
            try
            {
                link.Serial.Write(payload + "\n");
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "{Peer} USB write failed", link.Peer);
                _ = Task.Run(() => Close(link, "write failed"));
                return null;
            }

            var finished = await Task.WhenAny(waiter.Reply.Task, Task.Delay(timeoutMs)).ConfigureAwait(false);
            return finished == waiter.Reply.Task ? await waiter.Reply.Task.ConfigureAwait(false) : null;
        }
        finally
        {
            lock (link.Gate) link.Waiters.Remove(waiter);
        }
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => ScanLoopAsync(_cts.Token));
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _cts?.Cancel();
        if (_loop is not null)
        {
            try { await _loop.ConfigureAwait(false); } catch { }
        }
        foreach (var link in _links.Values.ToArray()) Close(link, "shutdown");
    }

    public void Dispose()
    {
        _cts?.Dispose();
        foreach (var link in _links.Values.ToArray()) Close(link, "dispose");
    }

    private async Task ScanLoopAsync(CancellationToken ct)
    {
        try { await Task.Delay(2500, ct).ConfigureAwait(false); } catch { return; }

        while (!ct.IsCancellationRequested)
        {
            try { Tick(); }
            catch (Exception ex) { _logger.LogDebug(ex, "USB accessory scan tick threw"); }
            try { await Task.Delay(ScanIntervalMs, ct).ConfigureAwait(false); } catch { break; }
        }
    }

    private void Tick()
    {
        IReadOnlyList<NcSenderUsbDevice> devices;
        try { devices = _catalog.GetDevices(); }
        catch { devices = []; }

        foreach (var link in _links.Values.ToArray())
        {
            var present = devices.Any(d => d.Kind == Peers[link.Peer]
                                           && string.Equals(d.PortName, link.Port, StringComparison.Ordinal));
            if (!present) Close(link, "device removed");
            else if (!link.Serial.IsOpen) Close(link, "port closed");
        }

        foreach (var (peer, kind) in Peers)
        {
            if (_links.ContainsKey(peer)) continue;
            var device = devices.FirstOrDefault(d => d.Kind == kind && !string.IsNullOrEmpty(d.PortName));
            if (device is null || _leases.IsSuspended(device.PortName)) continue;
            Open(peer, device.PortName);
        }

        // Ask a device that has gone quiet for its state. The Wireless I/O
        // reports on its own only while it is paired to a Wireless USB; on a
        // cable alone it says nothing unless asked, so its outputs' state
        // never showed and it never got the machine-state feed.
        var now = Environment.TickCount64;
        foreach (var link in _links.Values)
        {
            if (!NeedsStatePoll(link.Peer, Volatile.Read(ref link.LastStateTicks), now)) continue;
            try { link.Serial.Write("status\n"); }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "{Peer} USB status poll failed", link.Peer);
                _ = Task.Run(() => Close(link, "write failed"));
            }
        }
    }

    // Peers that answer "status" with their state line.
    private static readonly HashSet<string> StatePolled = new(StringComparer.OrdinalIgnoreCase) { "xio" };
    internal const int StateQuietMs = 3000;

    /// <summary>True when this peer should be asked for its state: nothing from it for a while.</summary>
    internal static bool NeedsStatePoll(string peer, long lastStateTicks, long now) =>
        StatePolled.Contains(peer) && (lastStateTicks == 0 || now - lastStateTicks >= StateQuietMs);

    private void Open(string peer, string port)
    {
        var serial = new SerialPort(port, BaudRate)
        {
            DtrEnable = true,
            RtsEnable = false,
            ReadTimeout = 500,
            WriteTimeout = 1000,
            NewLine = "\n",
        };
        try
        {
            serial.Open();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "{Peer} USB port {Port} could not be opened", peer, port);
            serial.Dispose();
            return;
        }

        var link = new Link { Peer = peer, Port = port, Serial = serial };
        serial.DataReceived += (_, _) => OnData(link);
        _links[peer] = link;
        _leases.Claim(port, () => Close(link, "firmware update in progress"));
        _devices?.SetWiredSender(peer, payload =>
        {
            try { link.Serial.Write(payload + "\n"); }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "{Peer} USB command write failed", peer);
                _ = Task.Run(() => Close(link, "write failed"));
            }
            return Task.CompletedTask;
        });
        _logger.LogInformation("{Peer} USB link open on {Port}", peer, port);
    }

    private void OnData(Link link)
    {
        try
        {
            var serial = link.Serial;
            if (!serial.IsOpen) return;
            var available = serial.BytesToRead;
            if (available <= 0) return;
            var chunk = new byte[available];
            var read = serial.Read(chunk, 0, available);

            for (var i = 0; i < read; i++)
            {
                var c = chunk[i];
                if (c == (byte)'\n')
                {
                    var line = System.Text.Encoding.ASCII.GetString(link.Rx.ToArray()).TrimEnd('\r');
                    link.Rx.Clear();
                    if (line.Length > 0) Dispatch(link, line);
                }
                else
                {
                    link.Rx.Add(c);
                    if (link.Rx.Count > 4096) link.Rx.Clear();
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "{Peer} USB read failed", link.Peer);
            _ = Task.Run(() => Close(link, "read failed"));
        }
    }

    /// <summary>
    /// What a device reports on its own, without the tag some put in front.
    /// The Wireless I/O writes the same line to USB as to the radio, tagged
    /// ("@xio status …", "@xio in 2 1 …"); the AutoDustBoot writes it bare.
    /// Null for anything else (answers to a command, boot chatter).
    ///
    /// The tag used to make the line unrecognisable here, so a cabled
    /// Wireless I/O never showed its state, and never got the machine-state
    /// feed either: that goes only to a device whose status shows a drawbar
    /// output. Without the feed the board holds its drawbar outputs off
    /// ("no DRO since boot"), so a cabled board refused every release.
    /// </summary>
    internal static string? ReportedState(string peer, string line)
    {
        var tag = "@" + peer + " ";
        var payload = line.StartsWith(tag, StringComparison.OrdinalIgnoreCase) ? line[tag.Length..] : line;
        return payload.StartsWith("status ", StringComparison.Ordinal) || payload.StartsWith("in ", StringComparison.Ordinal)
            ? payload : null;
    }

    private void Dispatch(Link link, string line)
    {
        if (ReportedState(link.Peer, line) is { } state)
        {
            Volatile.Write(ref link.LastStateTicks, Environment.TickCount64);
            _devices?.OnWiredLine(link.Peer, state);
        }

        lock (link.Gate)
        {
            foreach (var waiter in link.Waiters)
            {
                bool matched;
                try { matched = waiter.Match(line); } catch { matched = false; }
                if (matched) waiter.Reply.TrySetResult(line);
            }
        }
    }

    private void Close(Link link, string reason)
    {
        if (!((ICollection<KeyValuePair<string, Link>>)_links).Remove(new KeyValuePair<string, Link>(link.Peer, link)))
            return;

        _leases.Release(link.Port);
        _devices?.SetWiredSender(link.Peer, null);
        try { if (link.Serial.IsOpen) link.Serial.Close(); } catch { }
        try { link.Serial.Dispose(); } catch { }
        lock (link.Gate)
        {
            foreach (var waiter in link.Waiters) waiter.Reply.TrySetResult(null);
        }
        _logger.LogInformation("{Peer} USB link closed on {Port} ({Reason})", link.Peer, link.Port, reason);
    }
}
