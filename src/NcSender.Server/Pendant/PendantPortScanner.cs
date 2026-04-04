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
    private Timer? _scanTimer;
    private readonly Dictionary<string, TrackedDevice> _tracked = new();
    private readonly Dictionary<string, PendingPort> _pending = new();  // Open but not yet identified
    private readonly SemaphoreSlim _scanLock = new(1, 1);
    private bool _disposed;

    private const int ScanIntervalMs = 1500;
    private const int IdentifyTimeoutMs = 1000;

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

    public PendantPortScanner(ILogger logger, Func<string?> getCncPort)
    {
        _logger = logger;
        _getCncPort = getCncPort;
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
        _logger.LogInformation("Port scanner stopped");
    }

    public void ReleaseDevice(string port)
    {
        lock (_tracked)
            _tracked.Remove(port);
    }

    private async Task ScanAsync()
    {
        if (!await _scanLock.WaitAsync(0)) return;
        try
        {
            var cncPort = _getCncPort();
            var currentPorts = GetCandidatePorts(cncPort);

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
                .Where(p => !knownPorts.Contains(p) && !pendingPorts.Contains(p))
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

            // Give USB CDC time to stabilize (device may need to finish boot)
            await Task.Delay(100);

            var result = await SendIdAndWaitAsync(handler, port);
            if (result is not null)
                return new TrackedDevice(port, result.Value, handler);

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
    /// Sends $ID through an already-open handler and waits for response.
    /// Returns the device type or null if no response within timeout.
    /// </summary>
    private async Task<TrackedDevice?> RetryIdentifyAsync(PendingPort pending)
    {
        if (!pending.Handler.IsConnected) return null;

        var result = await SendIdAndWaitAsync(pending.Handler, pending.Port);
        if (result is null) return null;

        return new TrackedDevice(pending.Port, result.Value, pending.Handler);
    }

    /// <summary>
    /// Sends $ID and waits for response on a live handler. Does NOT open or close the port.
    /// </summary>
    private async Task<DeviceType?> SendIdAndWaitAsync(PendantSerialHandler handler, string port)
    {
        var tcs = new TaskCompletionSource<DeviceType>(TaskCreationOptions.RunContinuationsAsynchronously);

        void OnRaw(string line)
        {
            if (line == "$ID:pendant")
                tcs.TrySetResult(DeviceType.Pendant);
            else if (line == "$ID:dongle")
                tcs.TrySetResult(DeviceType.Dongle);
        }

        handler.RawMessageReceived += OnRaw;
        try
        {
            await handler.SendRawAsync("$ID");
            var timeout = Task.Delay(IdentifyTimeoutMs);
            var completed = await Task.WhenAny(tcs.Task, timeout);
            if (completed == tcs.Task)
                return tcs.Task.Result;

            return null;
        }
        finally
        {
            handler.RawMessageReceived -= OnRaw;
        }
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
