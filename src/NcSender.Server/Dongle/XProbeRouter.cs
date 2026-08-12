using System.IO.Ports;
using NcSender.Core.Interfaces;
using NcSender.Server.Connection;

namespace NcSender.Server.Dongle;

/// <summary>
/// Combined USB scanner + wireless subscriber + priority arbiter for the
/// xprobe device. Presents a single <see cref="IXProbeSource"/> that the
/// <see cref="XProbeTranslator"/> consumes without knowing which transport
/// the payload arrived on.
///
/// Priority: wired (USB) wins whenever a xprobe device is present on a USB
/// serial port. The wireless path keeps flowing (dongle still hears it,
/// heartbeats still arrive) but its <see cref="MessageReceived"/> notifications
/// are suppressed while USB is up — first-arrival semantics with less noise.
/// USB disconnect flips priority back to wireless within one heartbeat.
///
/// USB discovery: background probe of unclaimed serial ports every
/// <see cref="ScanIntervalMs"/> ms. Each candidate gets a <c>$ID</c> and
/// ~800 ms window; only <c>$ID:xprobe</c> is claimed. Other identities /
/// CNC-looking greetings release the port immediately.
/// </summary>
public sealed class XProbeRouter : IXProbeSource, IHostedService, IDisposable
{
    private const string DeviceName = "xprobe";
    private const int ScanIntervalMs = 4000;
    private const int IdentifyTimeoutMs = 800;
    private const int BaudRate = 115200;

    private readonly IDongleDeviceService _devices;
    private readonly ICncController _controller;
    private readonly ILogger<XProbeRouter> _logger;

    // Active USB link (null when wireless-only)
    private SerialPort? _usbPort;
    private string? _usbPortPath;
    private readonly object _usbLock = new();
    private readonly List<byte> _usbRxBuf = new(256);

    // Ports we've probed recently and want to skip until conditions change.
    // Cleared on every USB release so a re-enumerated device (unplug/replug,
    // brownout, or the port coming back with a different number) always gets
    // freshly probed instead of being remembered as "not xprobe" forever.
    private readonly HashSet<string> _blacklist = new(StringComparer.OrdinalIgnoreCase);

    private CancellationTokenSource? _cts;
    private Task? _scanTask;

    public bool UsbActive => _usbPort is { IsOpen: true };

    public event Action<string>? MessageReceived;
    public event Action<bool>? ConnectivityChanged;

    public XProbeRouter(IDongleDeviceService devices, ICncController controller, ILogger<XProbeRouter> logger)
    {
        _devices = devices;
        _controller = controller;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _devices.DeviceMessageReceived += OnWirelessMessage;
        _devices.DeviceConnectivityChanged += OnWirelessConnectivity;
        _cts = new CancellationTokenSource();
        _scanTask = Task.Run(() => ScanLoopAsync(_cts.Token));
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _devices.DeviceMessageReceived -= OnWirelessMessage;
        _devices.DeviceConnectivityChanged -= OnWirelessConnectivity;
        _cts?.Cancel();
        CloseUsb("shutdown");
        return _scanTask ?? Task.CompletedTask;
    }

    public void Dispose()
    {
        _cts?.Dispose();
        CloseUsb("dispose");
    }

    // ---- wireless side ----

    private void OnWirelessMessage(string name, string payload)
    {
        if (!string.Equals(name, DeviceName, StringComparison.OrdinalIgnoreCase)) return;
        if (UsbActive) return;   // wired wins — swallow wireless while USB is up
        Fire(payload);
    }

    private void OnWirelessConnectivity(string name, bool connected)
    {
        if (!string.Equals(name, DeviceName, StringComparison.OrdinalIgnoreCase)) return;
        if (UsbActive) return;
        FireConnectivity(connected);
    }

    // ---- USB side ----

    private async Task ScanLoopAsync(CancellationToken ct)
    {
        // Small startup delay to let the pendant/CNC scanner claim their ports
        // first, so we don't collide on the same candidates.
        try { await Task.Delay(2000, ct); } catch { return; }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Check-then-probe in the same tick: if CheckUsbAlive detects
                // a stale port and closes, ProbeOnce runs immediately instead
                // of waiting a full ScanIntervalMs. Cuts reclaim latency in
                // half after a re-enumeration.
                if (UsbActive) CheckUsbAlive();
                if (!UsbActive) ProbeOnce();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "XProbeRouter scan tick threw");
            }
            try { await Task.Delay(ScanIntervalMs, ct); } catch { break; }
        }
    }

    private void ProbeOnce()
    {
        foreach (var port in EnumerateCandidatePorts())
        {
            if (_blacklist.Contains(port)) continue;

            SerialPort? sp = null;
            try
            {
                // DtrEnable/RtsEnable stay FALSE: asserting either on open resets many
                // CNC controllers (CH340 auto-reset circuit, RP2350 boot pins). If we
                // accidentally open the CNC port during a scan, we must not reboot it.
                sp = new SerialPort(port, BaudRate)
                {
                    DtrEnable = false,
                    RtsEnable = false,
                    ReadTimeout = 200,
                    WriteTimeout = 500,
                };
                sp.Open();
                sp.DiscardInBuffer();
                sp.WriteLine("$ID");

                var deadline = Environment.TickCount64 + IdentifyTimeoutMs;
                var buf = new System.Text.StringBuilder();
                bool matched = false;
                while (Environment.TickCount64 < deadline)
                {
                    try
                    {
                        var chunk = sp.ReadExisting();
                        if (chunk.Length > 0) buf.Append(chunk);
                    }
                    catch { /* timeout ok */ }

                    var text = buf.ToString();
                    if (text.Contains("$ID:" + DeviceName, StringComparison.Ordinal))
                    {
                        matched = true;
                        break;
                    }
                    if (LooksLikeSomeoneElse(text))
                    {
                        _blacklist.Add(port);
                        break;
                    }
                    Thread.Sleep(50);
                }

                if (matched)
                {
                    ClaimUsbPort(sp!, port);
                    return;   // one xprobe is enough
                }
            }
            catch (Exception ex)
            {
                _logger.LogTrace(ex, "XProbeRouter probe of {Port} failed", port);
            }
            finally
            {
                if (sp is not null && (sp != _usbPort))
                {
                    try { if (sp.IsOpen) sp.Close(); } catch { }
                    sp.Dispose();
                }
            }
        }
    }

    private static bool LooksLikeSomeoneElse(string text)
    {
        return text.Contains("$ID:", StringComparison.Ordinal)          // some other accessory ($ID:pendant, $ID:dongle, …)
            || text.Contains("Grbl", StringComparison.OrdinalIgnoreCase) // CNC greeting
            || text.Contains("[VER:", StringComparison.OrdinalIgnoreCase)
            || text.Contains("[OPT:", StringComparison.OrdinalIgnoreCase)
            || text.Contains("error:", StringComparison.OrdinalIgnoreCase) // grblHAL rejects $ID → error:3
            || text.Contains("ok\r", StringComparison.Ordinal);           // some grbl variants ack $ID silently
    }

    private void ClaimUsbPort(SerialPort sp, string path)
    {
        lock (_usbLock)
        {
            _usbPort = sp;
            _usbPortPath = path;
            _usbRxBuf.Clear();
        }
        sp.DataReceived += OnUsbData;
        _logger.LogInformation("XPROBE USB claimed on {Port} — wired priority active", path);
        FireConnectivity(true);
        // Immediately ask for state so translator can drive controller to reality.
        _ = SendAsync("status");
    }

    private void CheckUsbAlive()
    {
        var sp = _usbPort;
        var path = _usbPortPath;
        if (sp is null || !sp.IsOpen)
        {
            CloseUsb("port closed");
            return;
        }

        // .NET's SerialPort.IsOpen stays true after the underlying tty is
        // yanked (unplug, brownout, USB re-enumeration to a different port
        // number) — the FD only faults on the next read/write. Meanwhile
        // OnUsbData never fires for a dead device, so the router happily
        // holds a phantom port and blocks fresh scans forever. Check the
        // system-level port list, which DOES reflect physical presence.
        try
        {
            var live = SerialPort.GetPortNames();
            bool present = false;
            foreach (var p in live)
            {
                if (string.Equals(p, path, StringComparison.Ordinal)) { present = true; break; }
            }
            if (!present) CloseUsb("device removed");
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "XProbeRouter GetPortNames failed during liveness check");
        }
    }

    private void CloseUsb(string reason)
    {
        SerialPort? old;
        string? oldPath;
        lock (_usbLock)
        {
            old = _usbPort;
            oldPath = _usbPortPath;
            _usbPort = null;
            _usbPortPath = null;
        }
        if (old is null) return;
        try { old.DataReceived -= OnUsbData; } catch { }
        try { if (old.IsOpen) old.Close(); } catch { }
        try { old.Dispose(); } catch { }
        // Fresh probe cycle after any release — a device that briefly
        // enumerated wrong (or coincided with a CNC greeting) should get a
        // second chance now that the state has changed.
        _blacklist.Clear();
        _logger.LogInformation("XPROBE USB released ({Port}, reason: {Reason}) — falling back to wireless", oldPath, reason);
        FireConnectivity(false);
    }

    private void OnUsbData(object sender, SerialDataReceivedEventArgs e)
    {
        var sp = _usbPort;
        if (sp is null || !sp.IsOpen) return;
        try
        {
            var available = sp.BytesToRead;
            if (available <= 0) return;
            var chunk = new byte[available];
            int read = sp.Read(chunk, 0, available);
            for (int i = 0; i < read; i++)
            {
                byte c = chunk[i];
                if (c == (byte)'\n')
                {
                    var line = System.Text.Encoding.ASCII.GetString(_usbRxBuf.ToArray()).TrimEnd('\r');
                    _usbRxBuf.Clear();
                    HandleUsbLine(line);
                }
                else
                {
                    _usbRxBuf.Add(c);
                    if (_usbRxBuf.Count > 512) _usbRxBuf.Clear();  // overflow safety
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "XProbeRouter USB read failed");
            CloseUsb("read exception");
        }
    }

    private void HandleUsbLine(string line)
    {
        // Only protocol frames — the XIAO shares this serial with LOGF debug
        // lines, so we filter to the "@xprobe " prefix that sendState() emits.
        const string tag = "@" + DeviceName + " ";
        if (!line.StartsWith(tag, StringComparison.Ordinal)) return;
        var payload = line.Substring(tag.Length);
        if (payload.Length == 0) return;
        Fire(payload);
    }

    // ---- shared plumbing ----

    private void Fire(string payload)
    {
        try { MessageReceived?.Invoke(payload); }
        catch (Exception ex) { _logger.LogWarning(ex, "XProbeRouter MessageReceived handler threw"); }
    }

    private void FireConnectivity(bool connected)
    {
        try { ConnectivityChanged?.Invoke(connected); }
        catch (Exception ex) { _logger.LogWarning(ex, "XProbeRouter ConnectivityChanged handler threw"); }
    }

    public Task SendAsync(string command)
    {
        var sp = _usbPort;
        if (sp is { IsOpen: true })
        {
            try
            {
                sp.WriteLine(command);
                return Task.CompletedTask;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "XProbeRouter USB write failed for '{Cmd}' — releasing port and falling through to wireless", command);
                // Write faults are how a physically-gone-but-still-open port
                // announces itself. Release now so the scan loop can pick up
                // whatever the device re-enumerated as, and don't spend the
                // next N ticks pretending the port is fine.
                CloseUsb("write failed");
            }
        }
        return _devices.SendAsync(DeviceName, command);
    }

    private IEnumerable<string> EnumerateCandidatePorts()
    {
        var currentUsb = _usbPortPath;
        var cncPort = GetActiveCncPort();
        var all = SerialPort.GetPortNames();
        var kept = new List<string>();
        foreach (var p in all)
        {
            if (!IsUsbSerial(p)) continue;
            if (p == currentUsb) continue;    // already ours
            if (cncPort is not null && string.Equals(p, cncPort, StringComparison.Ordinal))
                continue;                     // never probe the port grblHAL is on
            kept.Add(p);
        }
        // Drop /dev/tty.* twins when /dev/cu.* twin is present (macOS).
        var cuNames = new HashSet<string>(
            kept.Where(p => p.StartsWith("/dev/cu.", StringComparison.Ordinal))
                .Select(p => "/dev/tty." + p["/dev/cu.".Length..]));
        return kept.Where(p => !cuNames.Contains(p));
    }

    private string? GetActiveCncPort()
    {
        try
        {
            if (_controller.Transport is SerialTransport st) return st.PortPath;
        }
        catch { /* transport swap race — treat as unknown, worst case we probe once */ }
        return null;
    }

    private static bool IsUsbSerial(string p)
    {
        if (p.StartsWith("COM", StringComparison.OrdinalIgnoreCase)) return true;
        if (p.StartsWith("/dev/ttyUSB", StringComparison.Ordinal)) return true;
        if (p.StartsWith("/dev/ttyACM", StringComparison.Ordinal)) return true;
        if (p.StartsWith("/dev/cu.usb", StringComparison.Ordinal)) return true;
        if (p.StartsWith("/dev/cu.wch", StringComparison.Ordinal)) return true;
        if (p.StartsWith("/dev/cu.SLAB", StringComparison.Ordinal)) return true;
        return false;
    }
}
