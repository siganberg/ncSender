using System.IO.Ports;
using System.Text.Json;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Devices;

/// <summary>
/// Generic serial / OTA primitives that plugins can call. The server has NO
/// knowledge of what a plugin is talking to — it just:
///
///  - Enumerates USB serial ports (skipping the CNC port so we don't clobber
///    the active machine connection).
///  - Probes a port by writing a request line and matching a regex on the
///    reply (used for &quot;is this port my accessory?&quot; version handshakes).
///  - Runs the ncSender <c>$OTA:*</c> application-level flash protocol on a
///    port and streams progress via WebSocket events.
///
/// Plugins own everything that's device-specific — the version handshake
/// string, the version-number regex, the firmware repo, the asset naming.
/// This service is intentionally uninterested in any of that.
/// </summary>
public sealed class PluginSerialService : IPluginSerialService
{
    private const int DefaultBaud = 115200;
    private const int OtaChunkSize = 4096;
    private const int OtaInactivityTimeoutMs = 20000;

    private readonly ILogger<PluginSerialService> _logger;
    private readonly IBroadcaster _broadcaster;
    private readonly ISettingsManager _settings;
    private readonly ICncController _cnc;

    private readonly SemaphoreSlim _flashLock = new(1, 1);
    private CancellationTokenSource? _flashCts;
    private string? _activeFlashPort;

    public PluginSerialService(
        ILogger<PluginSerialService> logger,
        IBroadcaster broadcaster,
        ISettingsManager settings,
        ICncController cnc)
    {
        _logger = logger;
        _broadcaster = broadcaster;
        _settings = settings;
        _cnc = cnc;
    }

    // -------------------------------------------------------------------
    // Probe — plugin-driven port discovery
    // -------------------------------------------------------------------

    public PluginSerialProbeResult Probe(PluginSerialProbeRequest req)
    {
        var baud = req.Baud is > 0 ? req.Baud.Value : DefaultBaud;
        var timeout = req.TimeoutMs is > 0 ? req.TimeoutMs.Value : 800;
        var request = req.Request ?? "";
        var regex = string.IsNullOrEmpty(req.ResponsePattern)
            ? null
            : new Regex(req.ResponsePattern, RegexOptions.Compiled);

        var reserved = BuildReservedPorts();
        var candidates = req.Candidates is { Length: > 0 }
            ? req.Candidates
            : FilterUsbSerialPorts(SerialPort.GetPortNames());

        foreach (var port in candidates)
        {
            if (reserved.Contains(port)) continue;
            try
            {
                using var sp = new SerialPort(port, baud)
                {
                    DtrEnable = true,
                    RtsEnable = true,
                    ReadTimeout = 200,
                    WriteTimeout = 500,
                    NewLine = "\n",
                };
                sp.Open();
                Thread.Sleep(80);
                try { sp.DiscardInBuffer(); } catch { }

                if (!string.IsNullOrEmpty(request))
                    sp.Write(request);

                var deadline = DateTime.UtcNow.AddMilliseconds(timeout);
                while (DateTime.UtcNow < deadline)
                {
                    try
                    {
                        var line = sp.ReadLine()?.TrimEnd('\r');
                        if (string.IsNullOrEmpty(line)) continue;
                        if (regex is null)
                        {
                            return new PluginSerialProbeResult(true, port, line, null);
                        }
                        var m = regex.Match(line);
                        if (m.Success)
                        {
                            // If the regex has a named or first capture, return it as `match`.
                            var match = m.Groups.Count > 1 ? m.Groups[1].Value : m.Value;
                            return new PluginSerialProbeResult(true, port, line, match);
                        }
                    }
                    catch (TimeoutException) { /* keep polling */ }
                }
            }
            catch
            {
                // Port busy / unusable — skip
            }
        }
        return new PluginSerialProbeResult(false, null, null, null);
    }

    private HashSet<string> BuildReservedPorts()
    {
        var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (_cnc.IsConnected)
        {
            var cncPort = _settings.GetSetting<string>("connection.usbPort");
            if (!string.IsNullOrEmpty(cncPort)) reserved.Add(cncPort);
        }
        return reserved;
    }

    /// <summary>
    /// Trim <see cref="SerialPort.GetPortNames"/> down to only ports that
    /// look like USB serial connections. Without this the fallback probe on
    /// macOS blindly walks through ~25 devices (Bluetooth, debug consoles,
    /// tty duplicates of every cu port, …) — each burning ~1 s on timeout.
    ///
    /// Naming conventions we accept:
    ///   macOS:   /dev/cu.usbmodem*, /dev/cu.usbserial*, /dev/cu.wch*,
    ///            /dev/cu.SLAB*    (Silicon Labs)
    ///   Linux:   /dev/ttyACM*, /dev/ttyUSB*
    ///   Windows: COM*
    /// tty.* on macOS is dropped when its cu.* twin is present — same
    /// device, and opening tty.* blocks on modem control lines.
    /// </summary>
    private static string[] FilterUsbSerialPorts(string[] ports)
    {
        static bool IsUsb(string p)
        {
            if (p.StartsWith("COM", StringComparison.OrdinalIgnoreCase)) return true;
            if (p.StartsWith("/dev/ttyUSB", StringComparison.Ordinal)) return true;
            if (p.StartsWith("/dev/ttyACM", StringComparison.Ordinal)) return true;
            if (p.StartsWith("/dev/cu.usb", StringComparison.Ordinal)) return true;
            if (p.StartsWith("/dev/cu.wch", StringComparison.Ordinal)) return true;
            if (p.StartsWith("/dev/cu.SLAB", StringComparison.Ordinal)) return true;
            // Ignore /dev/cu.debug-console, /dev/cu.Bluetooth-*, etc.
            return false;
        }

        // Prefer cu.* over tty.* for the same base name (macOS gives us both).
        var kept = ports.Where(IsUsb).ToList();
        var cuNames = new HashSet<string>(
            kept.Where(p => p.StartsWith("/dev/cu.", StringComparison.Ordinal))
                .Select(p => "/dev/tty." + p["/dev/cu.".Length..]));
        return kept.Where(p => !cuNames.Contains(p)).ToArray();
    }

    // -------------------------------------------------------------------
    // OTA — ncSender $OTA:* protocol
    // -------------------------------------------------------------------

    public async Task FlashOtaAsync(string port, byte[] firmware, int? baud = null,
        string? deviceId = null, CancellationToken ct = default)
    {
        if (!await _flashLock.WaitAsync(0, ct))
            throw new InvalidOperationException("An OTA flash is already in progress");

        _flashCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _activeFlashPort = port;
        try
        {
            await BroadcastMessageAsync(deviceId, "info", $"Connecting on {port}…");

            using var sp = new SerialPort(port, baud ?? DefaultBaud)
            {
                DtrEnable = true,
                RtsEnable = true,
                ReadTimeout = 500,
                WriteTimeout = 5000,
                NewLine = "\n",
            };
            sp.Open();
            await Task.Delay(120, _flashCts.Token);
            try { sp.DiscardInBuffer(); } catch { }

            sp.Write($"$OTA:BEGIN:{firmware.Length}\n");
            _logger.LogInformation("Plugin OTA on {Port}: BEGIN ({Bytes} bytes)", port, firmware.Length);

            var reader = new SerialLineReader(sp);
            if (!await reader.WaitForAsync("$OTA:READY", TimeSpan.FromSeconds(5), _flashCts.Token))
                throw new IOException("Device did not respond $OTA:READY");

            await BroadcastMessageAsync(deviceId, "info", "Streaming firmware…");
            await StreamAsync(sp, reader, firmware, deviceId, _flashCts.Token);

            if (!await reader.WaitForAsync("$OTA:OK", TimeSpan.FromSeconds(15), _flashCts.Token))
                throw new IOException("Device did not confirm $OTA:OK");

            await BroadcastMessageAsync(deviceId, "info", "Firmware written, device rebooting…");
            await Task.Delay(1500, _flashCts.Token);
            await BroadcastEndAsync(deviceId);
        }
        catch (OperationCanceledException)
        {
            await BroadcastErrorAsync(deviceId, "Firmware update was cancelled");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Plugin OTA on {Port} failed", port);
            await BroadcastErrorAsync(deviceId, ex.Message);
            throw;
        }
        finally
        {
            _flashCts?.Dispose();
            _flashCts = null;
            _activeFlashPort = null;
            _flashLock.Release();
        }
    }

    public void Cancel()
    {
        try { _flashCts?.Cancel(); } catch { /* best effort */ }
    }

    public string? ActiveFlashPort => _activeFlashPort;

    private async Task StreamAsync(SerialPort port, SerialLineReader reader, byte[] data,
        string? deviceId, CancellationToken ct)
    {
        var offset = 0;
        var lastBand = -1;
        var lastByteAt = DateTime.UtcNow;

        while (offset < data.Length)
        {
            ct.ThrowIfCancellationRequested();

            var chunk = Math.Min(OtaChunkSize, data.Length - offset);
            port.BaseStream.Write(data, offset, chunk);
            port.BaseStream.Flush();
            offset += chunk;

            if (!await reader.WaitForAnyAsync(new[] { "$OTA:ACK" }, TimeSpan.FromSeconds(5), ct, allowProgress: true))
                throw new IOException($"Device did not ACK chunk at byte {offset}");

            var pct = (int)((100L * offset) / data.Length);
            var band = pct / 5;
            if (band != lastBand)
            {
                lastBand = band;
                await BroadcastProgressAsync(deviceId, pct);
            }

            if ((DateTime.UtcNow - lastByteAt).TotalMilliseconds > OtaInactivityTimeoutMs)
                throw new IOException("Firmware upload stalled (no ACK for 20 s)");
            lastByteAt = DateTime.UtcNow;
        }
    }

    // -------------------------------------------------------------------
    // Progress broadcasts — event name carries the deviceId so a plugin
    // can filter for its own accessory without racing other plugins.
    // -------------------------------------------------------------------

    private Task BroadcastProgressAsync(string? deviceId, int percent)
        => _broadcaster.Broadcast("plugin-ota:progress",
            JsonSerializer.SerializeToElement(new PluginOtaEvent(deviceId ?? "", percent, null, null),
                NcSenderJsonContext.Default.PluginOtaEvent));

    private Task BroadcastMessageAsync(string? deviceId, string type, string content)
        => _broadcaster.Broadcast("plugin-ota:message",
            JsonSerializer.SerializeToElement(new PluginOtaEvent(deviceId ?? "", null, type, content),
                NcSenderJsonContext.Default.PluginOtaEvent));

    private Task BroadcastErrorAsync(string? deviceId, string error)
        => _broadcaster.Broadcast("plugin-ota:error",
            JsonSerializer.SerializeToElement(new PluginOtaEvent(deviceId ?? "", null, "error", error),
                NcSenderJsonContext.Default.PluginOtaEvent));

    private Task BroadcastEndAsync(string? deviceId)
        => _broadcaster.Broadcast("plugin-ota:done",
            JsonSerializer.SerializeToElement(new PluginOtaEvent(deviceId ?? "", 100, null, null),
                NcSenderJsonContext.Default.PluginOtaEvent));
}

public interface IPluginSerialService
{
    PluginSerialProbeResult Probe(PluginSerialProbeRequest req);
    Task FlashOtaAsync(string port, byte[] firmware, int? baud = null, string? deviceId = null,
        CancellationToken ct = default);
    void Cancel();
    string? ActiveFlashPort { get; }
}

// -------------------- DTOs --------------------

public class PluginSerialProbeRequest
{
    public string[]? Candidates { get; set; }
    public int? Baud { get; set; }
    public int? TimeoutMs { get; set; }

    /// <summary>Text written to the port before we start listening. Include the trailing newline yourself.</summary>
    public string? Request { get; set; }

    /// <summary>Regex applied to each reply line. First capture (if any) becomes the returned match.</summary>
    public string? ResponsePattern { get; set; }
}

public record PluginSerialProbeResult(bool Found, string? Port, string? Line, string? Match);

/// <summary>Combined event payload used for progress / message / error / done.</summary>
public record PluginOtaEvent(string DeviceId, int? Percent, string? Type, string? Content);
