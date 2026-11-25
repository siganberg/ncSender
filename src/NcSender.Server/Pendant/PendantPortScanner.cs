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

    /// <summary>How long closing a lost device may take before the scan moves on without it.</summary>
    internal static readonly TimeSpan CloseTimeout = TimeSpan.FromSeconds(4);

    public event Action<TrackedDevice>? DeviceFound;
    public event Action<TrackedDevice>? DeviceLost;
    // A USB device with the Espressif default identity (VID 0x303A /
    // PID 0x1001) showed up but doesn't advertise one of our known
    // iProduct strings. Almost certainly a pendant or wireless dongle
    // running firmware that predates the USB descriptor rework.
    public event Action<NcSenderUsbDevice>? LegacyCandidateDetected;

    /// <summary>
    /// Any change to the set of ncSender USB devices present — including the
    /// accessories this scanner does not open (NcProbe, AutoDustBoot, RGB).
    ///
    /// Their cables matter even though the scanner ignores them: a cable decides
    /// whether an update goes wired or wireless, and the Accessories panel
    /// reports it. Without this, moving a cable from one accessory to another
    /// changed nobody's connectivity, so no event fired and the panel kept
    /// showing the old transport until it was closed and reopened.
    /// </summary>
    public event Action? UsbInventoryChanged;

    private string _lastInventory = "";

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
            // A CH340 port not listened to yet may be the PiBot pendant. The CNC
            // auto-connect opens with RTS on, which holds that pendant in reset,
            // so it waits here until the port is known not to be one.
            foreach (var port in UndecidedBridges()) ports.Add(port);
            return ports;
        }
    }

    private readonly NcSender.Server.Usb.UsbPortLeases? _leases;
    private readonly Func<string, bool> _isCncPort;
    // Opening a CH340 port resets what is behind it. Should that be a
    // controller ncSender reaches another way (network), a reset mid-job
    // would stop the job, so no port is listened to while the machine works.
    private readonly Func<bool> _machineBusy;

    // CH340 ports that were listened to and are not a pendant; left alone
    // until unplugged. Guarded by _tracked.
    private readonly HashSet<string> _bridgesRejected = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _bridgeOpenFailures = new(StringComparer.Ordinal);

    // The PiBot announces itself about 1 s after the reset that opening its
    // port causes (measured). Where opening does not reset it, one reset
    // pulse follows and it gets the same time again.
    internal static TimeSpan BridgeListen = TimeSpan.FromSeconds(2);
    internal static TimeSpan BridgeListenAfterReset = TimeSpan.FromSeconds(2.5);
    private const int BridgeOpenAttempts = 3;

    /// <param name="isCncPort">
    /// True for the port the CNC controller is on (connected, or saved in the
    /// connection settings). Such a port is never listened to.
    /// </param>
    /// <param name="machineBusy">True while a job runs or the machine moves: listening waits.</param>
    public PendantPortScanner(ILogger logger, INcSenderUsbCatalog usbCatalog,
                              NcSender.Server.Usb.UsbPortLeases? leases = null,
                              Func<string, bool>? isCncPort = null,
                              Func<bool>? machineBusy = null)
    {
        _machineBusy = machineBusy ?? (() => false);
        _logger = logger;
        _usbCatalog = usbCatalog;
        _leases = leases;
        _isCncPort = isCncPort ?? (_ => false);
    }

    /// <summary>
    /// CH340 ports that may still turn out to be the PiBot pendant: present,
    /// not the CNC's, not listened to yet. None while a pendant is on USB
    /// already: there is one pendant, so the others are left alone.
    /// </summary>
    private List<string> UndecidedBridges()
    {
        IReadOnlyList<NcSenderUsbDevice>? bridges;
        try { bridges = _usbCatalog.GetSerialBridges(); }
        catch { return []; }
        if (bridges is null || bridges.Count == 0) return [];

        var undecided = new List<string>();
        lock (_tracked)
        {
            if (_tracked.Values.Any(d => d.Type == DeviceType.Pendant)) return undecided;
            foreach (var b in bridges)
                if (!string.IsNullOrEmpty(b.PortName) && !_bridgesRejected.Contains(b.PortName))
                    undecided.Add(b.PortName);
        }
        undecided.RemoveAll(port =>
        {
            try { return _isCncPort(port); } catch { return true; }
        });
        return undecided;
    }

    private bool Busy()
    {
        try { return _machineBusy(); } catch { return true; }
    }

    /// <summary>A line only a CNC controller sends: the port is not a pendant.</summary>
    internal static bool LooksLikeController(string line) =>
        line.StartsWith("Grbl", StringComparison.OrdinalIgnoreCase)
        || line.Contains("FluidNC", StringComparison.OrdinalIgnoreCase)
        || line.StartsWith("[MSG:", StringComparison.Ordinal)
        || line.StartsWith("[VER:", StringComparison.Ordinal)
        || line.StartsWith("ALARM:", StringComparison.Ordinal)
        || line.StartsWith("error:", StringComparison.Ordinal)
        || (line.StartsWith('<') && line.EndsWith('>'));

    /// <summary>
    /// Open a CH340 port once and listen for the pendant's "$ID:pendant".
    /// Nothing is ever sent: bytes at the pendant's baud rate would reach a
    /// controller as noise, and noise can be a realtime command. Returns the
    /// open handler when it is the pendant; otherwise the port is closed and
    /// not opened again until it is replugged.
    /// </summary>
    private async Task<PendantSerialHandler?> ProbeBridgeAsync(string port)
    {
        var handler = new PendantSerialHandler(_logger);
        var verdict = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnLine(string line)
        {
            if (line.Contains("$ID:pendant", StringComparison.Ordinal)) verdict.TrySetResult(true);
            else if (LooksLikeController(line)) verdict.TrySetResult(false);
        }
        async Task<bool> DecidedWithin(TimeSpan limit) =>
            await Task.WhenAny(verdict.Task, Task.Delay(limit)) == verdict.Task;

        handler.RawMessageReceived += OnLine;
        try
        {
            await handler.ConnectAsync(port, bridge: true);
        }
        catch (Exception ex)
        {
            handler.RawMessageReceived -= OnLine;
            await CloseLostAsync(handler, port);
            int failures;
            lock (_tracked)
            {
                failures = _bridgeOpenFailures.GetValueOrDefault(port) + 1;
                _bridgeOpenFailures[port] = failures;
                if (failures >= BridgeOpenAttempts) _bridgesRejected.Add(port);
            }
            _logger.LogDebug("Could not open {Port} to listen for a pendant ({N}/{Max}): {Error}",
                port, failures, BridgeOpenAttempts, ex.Message);
            return null;
        }

        _logger.LogInformation("Listening on {Port} for a PiBot pendant", port);
        if (!await DecidedWithin(BridgeListen) && !_disposed)
        {
            await handler.PulseResetAsync();
            await DecidedWithin(BridgeListenAfterReset);
        }
        handler.RawMessageReceived -= OnLine;

        var isPendant = verdict.Task.IsCompletedSuccessfully && verdict.Task.Result;
        if (isPendant && !_disposed) return handler;

        await CloseLostAsync(handler, port);
        lock (_tracked) _bridgesRejected.Add(port);
        _logger.LogInformation("{Port} is not a pendant; leaving it alone until it is replugged", port);
        return null;
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
        _leases?.Release(port);
    }

    /// <summary>
    /// Close the handler of a device that is gone, without letting it hold the
    /// scan up. Closing a serial port whose device was pulled can block for
    /// ever on Linux. The scan holds its lock while it waits, so one port that
    /// would not close stopped every later scan: a pendant unplugged from USB
    /// left the Wireless USB undetectable after its next replug, until
    /// ncSender was restarted.
    /// </summary>
    private async Task CloseLostAsync(PendantSerialHandler handler, string port)
    {
        if (!await RunBoundedAsync(() => handler.DisposeAsync().AsTask(), CloseTimeout))
            _logger.LogWarning("Closing {Port} did not finish in {Seconds}s; carrying on without it",
                port, CloseTimeout.TotalSeconds);
    }

    /// <summary>
    /// Run <paramref name="work"/> off the caller's thread and wait for it no
    /// longer than <paramref name="limit"/>. False when it did not finish in
    /// time; it is then left to finish, or not, on its own. Its failures are
    /// swallowed: closing is best effort.
    /// </summary>
    internal static async Task<bool> RunBoundedAsync(Func<Task> work, TimeSpan limit)
    {
        var task = Task.Run(async () =>
        {
            try { await work(); } catch { /* best effort */ }
        });
        return await Task.WhenAny(task, Task.Delay(limit)) == task;
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

            // Ordinal-sorted so the signature is stable across enumeration order.
            var inventory = string.Join('|', catalogAll
                .Select(d => $"{d.Kind}:{d.PortName}")
                .OrderBy(x => x, StringComparer.Ordinal));
            if (inventory != _lastInventory)
            {
                _lastInventory = inventory;
                try { UsbInventoryChanged?.Invoke(); } catch { /* listener's problem */ }
            }

            var recognized = catalogAll
                .Where(d => d.Kind == NcSenderUsbKind.Pendant || d.Kind == NcSenderUsbKind.WirelessDongle)
                .ToDictionary(d => d.PortName, StringComparer.Ordinal);

            // The plain CH340 ports present, for the PiBot pendant.
            var bridgePorts = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                foreach (var b in _usbCatalog.GetSerialBridges() ?? [])
                    if (!string.IsNullOrEmpty(b.PortName)) bridgePorts.Add(b.PortName);
            }
            catch (Exception ex) { _logger.LogDebug(ex, "USB serial bridge enumeration failed"); }
            lock (_tracked)
            {
                // Unplugged: forget the verdict, so a replug is listened to again.
                _bridgesRejected.RemoveWhere(port => !bridgePorts.Contains(port));
                foreach (var gone in _bridgeOpenFailures.Keys.Where(port => !bridgePorts.Contains(port)).ToList())
                    _bridgeOpenFailures.Remove(gone);
            }

            // 1. Drop tracked entries that vanished from the catalog.
            List<KeyValuePair<string, TrackedDevice>> lost;
            lock (_tracked)
            {
                lost = _tracked.Where(kv => !recognized.ContainsKey(kv.Key) && !bridgePorts.Contains(kv.Key)).ToList();
                foreach (var kv in lost)
                    _tracked.Remove(kv.Key);
            }
            foreach (var kv in lost)
            {
                _logger.LogInformation("{Type} disappeared from {Port}", kv.Value.Type, kv.Key);
                await CloseLostAsync(kv.Value.Handler, kv.Key);
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
                await CloseLostAsync(kv.Value.Handler, kv.Key);
                DeviceLost?.Invoke(kv.Value);
            }

            // 3. Open + track any newly-visible catalog match.
            HashSet<string> knownPorts;
            lock (_tracked)
                knownPorts = new HashSet<string>(_tracked.Keys);

            foreach (var (port, device) in recognized)
            {
                if (knownPorts.Contains(port)) continue;

                // A firmware update owns the cable outright for its duration.
                // Without this the scan would reopen the port mid-flash and put a
                // second read loop back on the same tty — the exact race the
                // leases exist to stop, where the flasher's acks start landing in
                // this handler instead of the flasher's own reader.
                if (_leases?.IsSuspended(port) == true) continue;

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

                await TrackAsync(port, deviceType, handler, "via USB catalog (no probe)");
            }

            // 3b. The PiBot pendant: its CH340 names nothing, so each such port
            // is listened to once. One port per pass, so a scan stays short.
            var bridge = UndecidedBridges().FirstOrDefault(port => _leases?.IsSuspended(port) != true);
            if (bridge is not null && !_disposed && !Busy())
            {
                var handler = await ProbeBridgeAsync(bridge);
                if (handler is not null)
                    await TrackAsync(bridge, DeviceType.Pendant, handler, "by its own announcement (PiBot)");
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

    /// <summary>Take an opened, identified port into the tracked set and announce it.</summary>
    private async Task TrackAsync(string port, DeviceType deviceType, PendantSerialHandler handler, string how)
    {
        // Tell the arbiter how to get this port back, so a flash can
        // close us rather than opening a competing reader alongside.
        _leases?.Claim(port, () =>
        {
            try { handler.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(2)); }
            catch { /* best effort — the flash takes the port regardless */ }
            lock (_tracked) _tracked.Remove(port);
        });

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
            await CloseLostAsync(handler, port);
            return;
        }
        _logger.LogInformation("{Type} identified on {Port} {How}", deviceType, port, how);
        DeviceFound?.Invoke(tracked);
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
