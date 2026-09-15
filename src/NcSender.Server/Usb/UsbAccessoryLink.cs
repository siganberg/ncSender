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
        };

    private sealed class Link
    {
        public required string Peer { get; init; }
        public required string Port { get; init; }
        public required SerialPort Serial { get; init; }
        public List<byte> Rx { get; } = new(256);
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
    }

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

    private void Dispatch(Link link, string line)
    {
        if (line.StartsWith("status ", StringComparison.Ordinal)) _devices?.OnWiredLine(link.Peer, line);

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
