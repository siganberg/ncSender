using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Pendant;

/// <summary>
/// Background USB port scanner. Discovers ncSender pendants and wireless
/// dongles by consulting <see cref="INcSenderUsbCatalog"/> — a pure
/// USB-descriptor lookup, no port opens, no <c>$ID</c> probes, no port
/// lockups on Windows.
///
/// A port whose descriptors don't identify an ncSender accessory is
/// never touched. Legacy-firmware devices (VID 0x303A, PID 0x1001, no
/// custom iProduct string — probably an older pendant or dongle) surface
/// via <see cref="LegacyCandidateDetected"/> so the app can prompt the
/// user to update; the port stays closed until then.
/// </summary>
public class PendantPortScanner : IDisposable
{
    public enum DeviceType { Pendant, Dongle }

    public record TrackedDevice(string Port, DeviceType Type, PendantSerialHandler Handler);

    private readonly ILogger _logger;
    private readonly INcSenderUsbCatalog _usbCatalog;
    private Timer? _scanTimer;
    private readonly Dictionary<string, TrackedDevice> _tracked = new();
    // Ports we've already fired a legacy-firmware notice for this
    // session. Reset when the port disappears from the catalog so a
    // fresh replug re-notifies.
    private readonly HashSet<string> _flaggedLegacyPorts = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _scanLock = new(1, 1);
    private bool _disposed;

    private const int ScanIntervalMs = 1500;

    public event Action<TrackedDevice>? DeviceFound;
    public event Action<TrackedDevice>? DeviceLost;
    // A USB device with the Espressif default identity (VID 0x303A /
    // PID 0x1001) showed up but doesn't advertise one of our known
    // iProduct strings. Almost certainly a pendant or wireless dongle
    // running firmware that predates the USB descriptor rework.
    public event Action<NcSenderUsbDevice>? LegacyCandidateDetected;

    public TrackedDevice? Pendant
    {
        get { lock (_tracked) return _tracked.Values.FirstOrDefault(d => d.Type == DeviceType.Pendant); }
    }

    public TrackedDevice? Dongle
    {
        get { lock (_tracked) return _tracked.Values.FirstOrDefault(d => d.Type == DeviceType.Dongle); }
    }

    public HashSet<string> AllOccupiedPorts
    {
        get
        {
            var ports = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            lock (_tracked)
                foreach (var kv in _tracked) ports.Add(kv.Key);
            return ports;
        }
    }

    public PendantPortScanner(ILogger logger, INcSenderUsbCatalog usbCatalog)
    {
        _logger = logger;
        _usbCatalog = usbCatalog;
    }

    public void Start()
    {
        if (_scanTimer is not null) return;
        _logger.LogInformation("Port scanner started");
        _scanTimer = new Timer(_ => _ = ScanAsync(), null, 0, ScanIntervalMs);
    }

    public void Stop()
    {
        _scanTimer?.Dispose();
        _scanTimer = null;

        // Mark stopped before grabbing the lock so any scan that's queued
        // up but not yet running bails out instead of opening fresh ports.
        _disposed = true;

        var lockHeld = false;
        try { lockHeld = _scanLock.Wait(TimeSpan.FromSeconds(3)); }
        catch { /* best effort */ }

        List<PendantSerialHandler> handlersToDispose;
        lock (_tracked)
        {
            handlersToDispose = _tracked.Values.Select(d => d.Handler).ToList();
            _tracked.Clear();
        }
        _flaggedLegacyPorts.Clear();

        if (lockHeld)
        {
            try { _scanLock.Release(); } catch { /* best effort */ }
        }

        foreach (var handler in handlersToDispose)
        {
            try { handler.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(1)); }
            catch { /* best effort */ }
        }

        _logger.LogInformation("Port scanner stopped");
    }

    public void ReleaseDevice(string port)
    {
        lock (_tracked)
            _tracked.Remove(port);
    }

    private async Task ScanAsync()
    {
        if (_disposed) return;
        if (!await _scanLock.WaitAsync(0)) return;
        try
        {
            if (_disposed) return;

            IReadOnlyList<NcSenderUsbDevice> catalogAll;
            try { catalogAll = _usbCatalog.GetDevices(); }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "USB catalog enumeration failed");
                return;
            }

            var recognized = catalogAll
                .Where(d => d.Kind == NcSenderUsbKind.Pendant || d.Kind == NcSenderUsbKind.WirelessDongle)
                .ToDictionary(d => d.PortName, StringComparer.Ordinal);

            // 1. Drop tracked entries that vanished from the catalog.
            List<KeyValuePair<string, TrackedDevice>> lost;
            lock (_tracked)
            {
                lost = _tracked.Where(kv => !recognized.ContainsKey(kv.Key)).ToList();
                foreach (var kv in lost)
                    _tracked.Remove(kv.Key);
            }
            foreach (var kv in lost)
            {
                _logger.LogInformation("{Type} disappeared from {Port}", kv.Value.Type, kv.Key);
                try { await kv.Value.Handler.DisposeAsync(); } catch { /* best effort */ }
                DeviceLost?.Invoke(kv.Value);
            }

            // 2. Drop tracked entries whose handler died (pendant power-cycled
            // without a USB replug, etc). Free the port so the next scan can
            // reopen it cleanly.
            List<KeyValuePair<string, TrackedDevice>> disconnected;
            lock (_tracked)
            {
                disconnected = _tracked.Where(kv => !kv.Value.Handler.IsConnected).ToList();
                foreach (var kv in disconnected)
                    _tracked.Remove(kv.Key);
            }
            foreach (var kv in disconnected)
            {
                _logger.LogInformation("{Type} handler disconnected on {Port}", kv.Value.Type, kv.Key);
                try { await kv.Value.Handler.DisposeAsync(); } catch { /* best effort */ }
                DeviceLost?.Invoke(kv.Value);
            }

            // 3. Open + track any newly-visible catalog match.
            HashSet<string> knownPorts;
            lock (_tracked)
                knownPorts = new HashSet<string>(_tracked.Keys);

            foreach (var (port, device) in recognized)
            {
                if (knownPorts.Contains(port)) continue;

                var deviceType = device.Kind == NcSenderUsbKind.Pendant
                    ? DeviceType.Pendant
                    : DeviceType.Dongle;

                var handler = new PendantSerialHandler(_logger);
                try
                {
                    await handler.ConnectAsync(port);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug("Failed to open port {Port} for {Type}: {Error}", port, deviceType, ex.Message);
                    continue;
                }

                var tracked = new TrackedDevice(port, deviceType, handler);
                bool duplicate = false;
                lock (_tracked)
                {
                    if (_tracked.Values.Any(d => d.Type == deviceType))
                        duplicate = true;
                    else
                        _tracked[port] = tracked;
                }
                if (duplicate)
                {
                    _logger.LogWarning("Already tracking {Type}, ignoring {NewPort}", deviceType, port);
                    try { await handler.DisposeAsync(); } catch { /* best effort */ }
                    continue;
                }
                _logger.LogInformation("{Type} identified on {Port} via USB catalog (no probe)", deviceType, port);
                DeviceFound?.Invoke(tracked);
            }

            // 4. Notify about legacy-firmware candidates. The catalog emits
            // Espressif-VID/default-PID devices with Kind==Unknown; that's
            // the "probably a pendant or dongle on old firmware" bucket.
            // Fire one notice per session per port; clear the flag when the
            // port disappears so a fresh replug re-notifies.
            var seenPorts = new HashSet<string>(
                catalogAll.Select(d => d.PortName), StringComparer.Ordinal);
            _flaggedLegacyPorts.RemoveWhere(p => !seenPorts.Contains(p));

            foreach (var legacy in catalogAll.Where(d => d.Kind == NcSenderUsbKind.Unknown))
            {
                if (_flaggedLegacyPorts.Add(legacy.PortName))
                {
                    _logger.LogInformation(
                        "Legacy-firmware candidate on {Port} (VID={Vid:X4} PID={Pid:X4} product={Product})",
                        legacy.PortName, legacy.Vid, legacy.Pid, legacy.ProductString ?? "?");
                    LegacyCandidateDetected?.Invoke(legacy);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Port scan error");
        }
        finally
        {
            _scanLock.Release();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();

        lock (_tracked)
            _tracked.Clear();
        _flaggedLegacyPorts.Clear();
        _scanLock.Dispose();
    }
}
