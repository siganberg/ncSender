using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Pendant;

/// <summary>
/// Background USB port scanner that discovers and tracks pendant and dongle devices.
///
/// Pendant firmware has enableReboot(false) so opening/closing ports is safe.
/// Dead handlers are closed to free the OS port for reconnection
/// (e.g., pendant power-cycled without USB cable replug).
///
/// States for each port:
///   - Open but unidentified ("pending") → retry $ID every scan cycle
///   - Identified as pendant or dongle ("tracked") → fire DeviceFound, stop probing
///   - Port disappeared from OS or handler died → fire DeviceLost, close and re-probe
/// </summary>
public class PendantPortScanner : IDisposable
{
    public enum DeviceType { Pendant, Dongle }

    public record TrackedDevice(string Port, DeviceType Type, PendantSerialHandler Handler);

    /// <summary>A port that's open but not yet identified. $ID is retried each cycle.</summary>
    private record PendingPort(string Port, PendantSerialHandler Handler);

    private readonly ILogger _logger;
    private readonly Func<string?> _getCncPort;
    private readonly INcSenderUsbCatalog? _usbCatalog;
    private Timer? _scanTimer;
    private readonly Dictionary<string, TrackedDevice> _tracked = new();
    private readonly Dictionary<string, PendingPort> _pending = new();  // Open but not yet identified
    private readonly HashSet<string> _cncBlacklist = new(StringComparer.OrdinalIgnoreCase); // Ports that responded as a CNC controller
    private readonly SemaphoreSlim _scanLock = new(1, 1);
    private bool _disposed;

    private const int ScanIntervalMs = 1500;
    private const int IdentifyTimeoutMs = 1000;
    // Passive-listen window after opening a port. Firmware-side auto-
    // announce fires within a few hundred ms of Serial ready; 1500 ms
    // gives comfortable margin for a chip that resets on our port-open.
    private const int PassiveListenMs = 1500;

    public event Action<TrackedDevice>? DeviceFound;
    public event Action<TrackedDevice>? DeviceLost;

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
            foreach (var kv in _pending) ports.Add(kv.Key);
            return ports;
        }
    }

    public PendantPortScanner(ILogger logger, Func<string?> getCncPort, INcSenderUsbCatalog? usbCatalog = null)
    {
        _logger = logger;
        _getCncPort = getCncPort;
        _usbCatalog = usbCatalog;
    }

    // Fast identification from the USB descriptor catalog. Returns the
    // device type when the port's USB VID/PID (or iProduct fallback)
    // matches a known ncSender accessory, otherwise null. Consuming
    // this in OpenAndProbeAsync skips the ~1.5 s passive listen + up
    // to two 1 s probe rounds — modern firmware attaches in one tick.
    private DeviceType? FastIdentifyFromCatalog(string port)
    {
        if (_usbCatalog is null) return null;
        NcSenderUsbDevice? match;
        try
        {
            match = _usbCatalog.GetDevices()
                .FirstOrDefault(d => string.Equals(d.PortName, port, StringComparison.Ordinal));
        }
        catch (Exception ex)
        {
            _logger.LogTrace(ex, "USB catalog lookup for {Port} threw", port);
            return null;
        }
        if (match is null) return null;
        return match.Kind switch
        {
            NcSenderUsbKind.Pendant => DeviceType.Pendant,
            NcSenderUsbKind.WirelessDongle => DeviceType.Dongle,
            _ => (DeviceType?)null,
        };
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

        // Wait for any in-flight scan to finish before clearing state.
        // Without this, a scan that's mid-ConnectAsync (e.g. user changes
        // transport just as we open a new candidate port) completes after
        // Stop() returns and leaves an orphan SerialPort holding the OS
        // handle — the controller can't reopen the port and the user has
        // to restart the app. The scan's OpenAndProbeAsync owns its
        // handler's lifecycle, so by the time it releases the lock the
        // handler is either tracked, pending, or already disposed.
        var lockHeld = false;
        try { lockHeld = _scanLock.Wait(TimeSpan.FromSeconds(3)); }
        catch { /* best effort */ }

        // Release all open ports so the OS frees the handles. Otherwise a
        // subsequent transport switch (e.g. user moves CNC from ethernet to
        // USB) finds the controller's USB port still held by us and the
        // controller's ConnectAsync hangs. Closing is safe because we open
        // with both DTR and RTS high — close doesn't pulse a reset on the
        // ESP32 auto-reset network.
        List<PendantSerialHandler> handlersToDispose;
        lock (_tracked)
        {
            handlersToDispose = _tracked.Values.Select(d => d.Handler).ToList();
            _tracked.Clear();
        }
        foreach (var pp in _pending.Values)
            handlersToDispose.Add(pp.Handler);
        _pending.Clear();

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

            var cncPort = _getCncPort();
            var currentPorts = GetCandidatePorts(cncPort);

            // Drop blacklist entries for ports that physically disappeared so
            // a real pendant plugged into the same port later can be probed.
            _cncBlacklist.RemoveWhere(p => !currentPorts.Contains(p));

            // 1. Clean up disappeared tracked devices
            List<KeyValuePair<string, TrackedDevice>> lost;
            lock (_tracked)
            {
                lost = _tracked.Where(kv => !currentPorts.Contains(kv.Key)).ToList();
                foreach (var kv in lost)
                    _tracked.Remove(kv.Key);
            }
            foreach (var kv in lost)
            {
                _logger.LogInformation("{Type} disappeared from {Port}", kv.Value.Type, kv.Key);
                try { await kv.Value.Handler.DisposeAsync(); } catch { /* best effort */ }
                DeviceLost?.Invoke(kv.Value);
            }

            // 2. Clean up tracked devices whose handler died
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
                // Close the dead handler to free the OS port for reopening
                // (e.g., pendant power-cycled without USB replug)
                try { await kv.Value.Handler.DisposeAsync(); } catch { /* best effort */ }
                DeviceLost?.Invoke(kv.Value);
            }

            // 3. Clean up disappeared pending ports (unplugged before identified)
            var disappearedPending = _pending.Where(kv => !currentPorts.Contains(kv.Key)).Select(kv => kv.Key).ToList();
            foreach (var port in disappearedPending)
            {
                _logger.LogDebug("Pending port {Port} disappeared", port);
                try { await _pending[port].Handler.DisposeAsync(); } catch { /* best effort */ }
                _pending.Remove(port);
            }

            // Also clean up pending ports whose handler died
            var deadPending = _pending.Where(kv => !kv.Value.Handler.IsConnected).Select(kv => kv.Key).ToList();
            foreach (var port in deadPending)
            {
                _logger.LogDebug("Pending port {Port} handler died", port);
                try { await _pending[port].Handler.DisposeAsync(); } catch { /* best effort */ }
                _pending.Remove(port);
            }

            // 4. Retry $ID on pending ports (already open — no reset risk)
            foreach (var kv in _pending.ToList())
            {
                TrackedDevice? result;
                try
                {
                    result = await RetryIdentifyAsync(kv.Value);
                }
                catch (Exception ex)
                {
                    // Handler died (port closed, timeout, etc.) — remove and let next cycle re-probe
                    _logger.LogDebug("Pending port {Port} retry failed: {Error}", kv.Key, ex.Message);
                    try { await kv.Value.Handler.DisposeAsync(); } catch { }
                    _pending.Remove(kv.Key);
                    continue;
                }
                if (result is null) continue;

                _pending.Remove(kv.Key);
                lock (_tracked)
                {
                    var existing = _tracked.Values.FirstOrDefault(d => d.Type == result.Type);
                    if (existing is not null)
                    {
                        _logger.LogWarning("Already tracking {Type} on {Port}, ignoring {NewPort}",
                            result.Type, existing.Port, kv.Key);
                        continue;
                    }
                    _tracked[kv.Key] = result;
                }
                _logger.LogInformation("{Type} identified on {Port}", result.Type, kv.Key);
                DeviceFound?.Invoke(result);
            }

            // 5. Open new ports (first time only — they stay open)
            HashSet<string> knownPorts;
            lock (_tracked)
                knownPorts = new HashSet<string>(_tracked.Keys);
            var pendingPorts = new HashSet<string>(_pending.Keys);

            var newPorts = currentPorts
                .Where(p => !knownPorts.Contains(p)
                         && !pendingPorts.Contains(p)
                         && !_cncBlacklist.Contains(p))
                .ToList();

            foreach (var port in newPorts)
            {
                var pending = await OpenAndProbeAsync(port);
                if (pending is null) continue;

                // Check if we got an immediate $ID response
                if (pending is TrackedDevice tracked)
                {
                    lock (_tracked)
                    {
                        var existing = _tracked.Values.FirstOrDefault(d => d.Type == tracked.Type);
                        if (existing is not null)
                        {
                            _logger.LogWarning("Already tracking {Type} on {Port}, ignoring {NewPort}",
                                tracked.Type, existing.Port, port);
                            continue;
                        }
                        _tracked[port] = tracked;
                    }
                    _logger.LogInformation("{Type} identified on {Port}", tracked.Type, port);
                    DeviceFound?.Invoke(tracked);
                }
                else if (pending is PendingPort pp)
                {
                    _pending[port] = pp;
                    _logger.LogDebug("Port {Port} opened, awaiting $ID response", port);
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

    /// <summary>
    /// Opens a new port and sends $ID. Returns TrackedDevice if identified immediately,
    /// PendingPort if the port opened but didn't respond yet, or null if open failed.
    /// The port is NEVER closed — it stays open for future retry.
    /// </summary>
    private async Task<object?> OpenAndProbeAsync(string port)
    {
        PendantSerialHandler? handler = null;
        try
        {
            handler = new PendantSerialHandler(_logger);
            await handler.ConnectAsync(port);

            var fast = FastIdentifyFromCatalog(port);
            if (fast is { } fastType)
            {
                _logger.LogInformation("{Type} identified on {Port} via USB catalog (no probe)", fastType, port);
                return new TrackedDevice(port, fastType, handler);
            }

            // Step 0 (passive listen): if this port belongs to a pendant or
            // dongle, the firmware auto-announces `$ID:pendant` or
            // `$ID:dongle` on Serial ready. Catching that lets us identify
            // the device without sending anything ourselves — which matters
            // because sending `$ID` to a FluidNC controller has been linked
            // to firmware crashes, and the pibot pendant enters a permanent-
            // blackout state if we send commands during its early boot.
            // If nothing announces in ~1.5s, fall through to the active
            // probes below.
            var passive = await PassiveListenForIdAsync(handler, port);
            if (passive is not null) return passive;

            // Step 1: GRBL/FluidNC always responds to '?' with a status report.
            // Pendants don't. This is the most reliable way to tell them apart
            // — the FluidNC and pendant can be the same hardware (ESP32-S3),
            // so VID/PID won't differentiate. Avoids sending $ID to the
            // controller, which has been linked to FluidNC v4.0.3 crashes
            // when both transports talk to it at once.
            if (await IsCncControllerAsync(handler, port))
            {
                _cncBlacklist.Add(port);
                try { await handler.DisposeAsync(); } catch { /* best effort */ }
                return null;
            }

            // Step 2: not a CNC and didn't announce — send explicit $ID.
            // Older pendant firmware without auto-announce still identifies
            // this way.
            var result = await SendIdAndWaitAsync(handler, port);

            if (result.IsCnc)
            {
                _cncBlacklist.Add(port);
                try { await handler.DisposeAsync(); } catch { /* best effort */ }
                return null;
            }

            if (result.Device is { } deviceType)
                return new TrackedDevice(port, deviceType, handler);

            // No response yet — keep open as pending
            return new PendingPort(port, handler);
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Failed to open port {Port}: {Error}", port, ex.Message);
            // Don't try to close on failure — if Open() succeeded, dropping reference
            // is safer than Close() which could trigger CDC reset
            return null;
        }
    }

    /// <summary>
    /// Sends '?' and watches for a GRBL-style status report '&lt;...&gt;'.
    /// Returns true when this port is talking to a CNC controller.
    /// </summary>
    private async Task<bool> IsCncControllerAsync(PendantSerialHandler handler, string port)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        void OnRaw(string line)
        {
            var trimmed = line.TrimStart();
            // Status report (the canonical GRBL/FluidNC '?' response)
            if (trimmed.StartsWith("<", StringComparison.Ordinal) && trimmed.Contains(">", StringComparison.Ordinal))
                tcs.TrySetResult(true);
            // Other CNC banners that might land in the same window (boot
            // banner from a DTR-triggered reset, error reply, etc.)
            else if (LooksLikeCncController(line))
                tcs.TrySetResult(true);
        }

        handler.RawMessageReceived += OnRaw;
        try
        {
            await handler.SendRawAsync("?");
            var completed = await Task.WhenAny(tcs.Task, Task.Delay(200));
            if (completed == tcs.Task && tcs.Task.Result)
            {
                _logger.LogInformation("Port {Port} responded to '?' as a CNC controller, skipping pendant probe", port);
                return true;
            }
            return false;
        }
        finally
        {
            handler.RawMessageReceived -= OnRaw;
        }
    }

    /// <summary>
    /// Sends $ID through an already-open handler and waits for response.
    /// Returns the device type or null if no response within timeout.
    /// </summary>
    private async Task<TrackedDevice?> RetryIdentifyAsync(PendingPort pending)
    {
        if (!pending.Handler.IsConnected) return null;

        var result = await SendIdAndWaitAsync(pending.Handler, pending.Port);

        if (result.IsCnc)
        {
            _cncBlacklist.Add(pending.Port);
            try { await pending.Handler.DisposeAsync(); } catch { /* best effort */ }
            _pending.Remove(pending.Port);
            return null;
        }

        if (result.Device is { } deviceType)
            return new TrackedDevice(pending.Port, deviceType, pending.Handler);

        return null;
    }

    /// <summary>
    /// Sends $ID and waits for response on a live handler. Does NOT open or close the port.
    /// </summary>
    private record IdResult(DeviceType? Device, bool IsCnc);

    private async Task<IdResult> SendIdAndWaitAsync(PendantSerialHandler handler, string port)
    {
        var tcs = new TaskCompletionSource<IdResult>(TaskCreationOptions.RunContinuationsAsynchronously);

        void OnRaw(string line)
        {
            if (line == "$ID:pendant")
                tcs.TrySetResult(new IdResult(DeviceType.Pendant, false));
            else if (line == "$ID:dongle")
                tcs.TrySetResult(new IdResult(DeviceType.Dongle, false));
            // Other ncSender accessories (e.g. $ID:autodustboot) speak the
            // same handshake but aren't a pendant or dongle. Blacklist so
            // their plugin can talk to the port instead of us squatting on
            // it forever in "pending".
            else if (line.StartsWith("$ID:"))
            {
                _logger.LogInformation("Port {Port} identifies as {Id}, releasing from pendant probe", port, line);
                tcs.TrySetResult(new IdResult(null, true));
            }
            // The port might already be carrying a CNC controller (e.g. user
            // is on ethernet but USB is also plugged in). Repeated $ID probes
            // crash FluidNC v4.0.3 over wireless. Detect the GRBL/FluidNC
            // signature, blacklist the port, and stop hammering it.
            else if (LooksLikeCncController(line))
            {
                _logger.LogInformation("Port {Port} appears to be a CNC controller, skipping pendant probe", port);
                tcs.TrySetResult(new IdResult(null, true));
            }
        }

        handler.RawMessageReceived += OnRaw;
        try
        {
            await handler.SendRawAsync("$ID");
            var timeout = Task.Delay(IdentifyTimeoutMs);
            var completed = await Task.WhenAny(tcs.Task, timeout);
            if (completed == tcs.Task)
                return tcs.Task.Result;

            return new IdResult(null, false);
        }
        finally
        {
            handler.RawMessageReceived -= OnRaw;
        }
    }

    /// <summary>
    /// Passively listens for a firmware-side auto-announce after the port
    /// is opened. Sends nothing — a `$ID:pendant` / `$ID:dongle` printed by
    /// the device during boot is enough to identify it. Also blacklists the
    /// port immediately if the boot output looks like a CNC controller so
    /// the caller can skip the active probe. Returns:
    ///   * TrackedDevice — device auto-announced (identified).
    ///   * null (with port blacklisted + handler disposed) — CNC controller signature.
    ///   * null (no side effect) — nothing heard; caller should fall through to active probe.
    /// </summary>
    private async Task<object?> PassiveListenForIdAsync(PendantSerialHandler handler, string port)
    {
        var tcs = new TaskCompletionSource<IdResult>(TaskCreationOptions.RunContinuationsAsynchronously);

        void OnRaw(string line)
        {
            if (line == "$ID:pendant")
                tcs.TrySetResult(new IdResult(DeviceType.Pendant, false));
            else if (line == "$ID:dongle")
                tcs.TrySetResult(new IdResult(DeviceType.Dongle, false));
            else if (line.StartsWith("$ID:"))
            {
                _logger.LogInformation("Port {Port} passively identified as {Id}, releasing from pendant probe", port, line);
                tcs.TrySetResult(new IdResult(null, true));
            }
            else if (LooksLikeCncController(line))
            {
                _logger.LogInformation("Port {Port} passive listen: CNC controller signature, skipping pendant probe", port);
                tcs.TrySetResult(new IdResult(null, true));
            }
        }

        handler.RawMessageReceived += OnRaw;
        try
        {
            var completed = await Task.WhenAny(tcs.Task, Task.Delay(PassiveListenMs));
            if (completed != tcs.Task) return null;                    // silence → fall through
            var result = tcs.Task.Result;
            if (result.IsCnc)
            {
                _cncBlacklist.Add(port);
                try { await handler.DisposeAsync(); } catch { /* best effort */ }
                return null;
            }
            if (result.Device is { } deviceType)
                return new TrackedDevice(port, deviceType, handler);
            return null;
        }
        finally
        {
            handler.RawMessageReceived -= OnRaw;
        }
    }

    private static bool LooksLikeCncController(string line)
    {
        var trimmed = line.TrimStart();
        return trimmed.StartsWith("Grbl ", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("[MSG:INFO: FluidNC", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("[VER:", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("[OPT:", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("error:", StringComparison.OrdinalIgnoreCase);
    }

    private HashSet<string> GetCandidatePorts(string? excludePort)
    {
        // On macOS, each USB device appears as both /dev/cu.* and /dev/tty.*.
        // Deduplicate by normalized key, preferring /dev/cu.* (for outgoing connections).
        var seen = new Dictionary<string, string>();
        foreach (var port in PendantSerialHandler.GetAvailablePorts())
        {
            if (!string.IsNullOrEmpty(excludePort) && IsSameSerialPort(port, excludePort))
                continue;

            var lower = port.ToLowerInvariant();
            // Windows COM ports, macOS /dev/cu.usb*, Linux /dev/ttyUSB* and /dev/ttyACM*
            var isWindows = lower.StartsWith("com", StringComparison.Ordinal) && lower.Length >= 4 && char.IsDigit(lower[3]);
            if (!isWindows && !lower.Contains("usbmodem") && !lower.Contains("usbserial") &&
                !lower.Contains("ttyusb") && !lower.Contains("ttyacm"))
                continue;

            var key = NormalizeMacPort(port);
            if (!seen.ContainsKey(key))
                seen[key] = port;
            else if (port.StartsWith("/dev/cu.", StringComparison.Ordinal))
                seen[key] = port;
        }
        return new HashSet<string>(seen.Values);
    }

    private static bool IsSameSerialPort(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase))
            return true;
        return string.Equals(NormalizeMacPort(a), NormalizeMacPort(b), StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeMacPort(string port)
    {
        if (port.StartsWith("/dev/cu.", StringComparison.Ordinal))
            return "/dev/tty." + port[8..];
        return port;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();

        lock (_tracked)
            _tracked.Clear();
        _pending.Clear();

        // Don't close handlers — dropping references lets GC collect without CDC reset.
        _scanLock.Dispose();
    }
}
