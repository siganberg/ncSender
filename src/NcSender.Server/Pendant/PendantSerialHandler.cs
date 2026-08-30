using System.IO.Ports;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace NcSender.Server.Pendant;

public class PendantSerialHandler : IAsyncDisposable
{
    private readonly ILogger _logger;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private SerialPort? _port;
    private CancellationTokenSource? _readCts;
    private Task? _readTask;

    // Known pendant VID/PIDs
    private static readonly (string Vid, string Pid, string Name)[] KnownDevices =
    [
        ("303a", "1001", "ESP32-S3"),
        ("10c4", "ea60", "CP210x"),
        ("1a86", "7523", "CH340"),
        ("0403", "6001", "FTDI")
    ];

    // A port handle can stay "open" long after the device behind it is gone: on
    // Linux an unplug (or a self-reset + re-enumeration) fails the read with an
    // IOException but leaves SerialPort.IsOpen true. Reporting connected on a
    // dead handle is what let a re-enumerated dongle sit behind a stale fd
    // forever — green icon, no traffic, only a restart clearing it. The read
    // loop owns this flag: once it exits on error, the handle is not connected.
    private volatile bool _readLoopDead;

    public virtual bool IsConnected => _port?.IsOpen == true && !_readLoopDead;
    public virtual string? ConnectedPort => _port?.PortName;
    public string? DeviceVersion { get; internal set; }
    public string? DeviceId { get; internal set; }
    public string? DeviceModel { get; internal set; }
    public bool Licensed { get; internal set; }

    public event Action<JsonElement>? MessageReceived;
    public event Action<string>? RawMessageReceived;
    public event Action? PortDisconnected;

    // Protected helpers for testability
    protected void FireRawMessage(string message) => RawMessageReceived?.Invoke(message);
    protected void FirePortDisconnected() => PortDisconnected?.Invoke();
    protected bool HasRawSubscribers => RawMessageReceived is not null;

    public PendantSerialHandler(ILogger logger)
    {
        _logger = logger;
    }

    public async Task ConnectAsync(string port)
    {
        if (_port?.IsOpen == true)
            await DisconnectAsync();

        // Open with `DtrEnable=true, RtsEnable=false` — the pre-v0.2.43
        // setting. This state matches the classic Espressif auto-reset
        // circuit's "chip runs" combination for the pibot pendant. Opening
        // with `RtsEnable=true` was added in commit 1e44699 to protect a
        // FluidNC-shared-cable scenario, but it triggers a permanent-blackout
        // state on the pibot pendant's CH340-bridged board. FluidNC is
        // protected differently now: the scanner probes with `?`, identifies
        // it as a CNC controller from the boot banner, blacklists the port
        // and never re-probes — so FluidNC absorbs at most ONE reset from
        // the initial probe and then runs unmolested. The pibot pendant is
        // identified passively via its firmware auto-announce of
        // `$ID:pendant` on Serial.begin(), catching the announcement without
        // sending anything that could bother a CNC controller.
        _port = new SerialPort(port, 460800)
        {
            DtrEnable = true,
            RtsEnable = false,
            ReadTimeout = SerialPort.InfiniteTimeout,
            WriteTimeout = 5000
        };

        _port.Open();
        _readLoopDead = false;
        _readCts = new CancellationTokenSource();

        if (OperatingSystem.IsWindows())
        {
            // Windows: use DataReceived event (BaseStream.ReadAsync unreliable with CH340)
            _port.DataReceived += OnDataReceived;
        }
        else
        {
            // macOS/Linux: use async read loop
            _readTask = ReadLoopAsync(_readCts.Token);
        }

        _logger.LogInformation("Serial port opened: {Port}", port);
    }

    public async Task DisconnectAsync()
    {
        _readCts?.Cancel();

        // Close port first to unblock ReadAsync (CancellationToken alone
        // doesn't interrupt serial reads on macOS/Linux)
        var port = _port;
        _port = null;
        var hadPort = port is not null;

        if (port is not null)
        {
            try
            {
                port.DataReceived -= OnDataReceived;
                if (port.IsOpen) port.Close();
            }
            catch { /* best effort */ }
            port.Dispose();
        }

        if (_readTask is not null)
        {
            try { await _readTask; }
            catch (OperationCanceledException) { }
            catch { /* best effort */ }
        }

        _readCts?.Dispose();
        _readCts = null;
        _readTask = null;
        DeviceVersion = null;
        DeviceId = null;
        DeviceModel = null;
        Licensed = false;

        if (hadPort)
            _logger.LogDebug("Serial handler disconnected");
    }

    // NOTE: neither write calls BaseStream.Flush().
    //
    // Write() hands the bytes to the driver and honours WriteTimeout; Flush() is
    // a tcdrain, which waits for the hardware to finish sending and honours no
    // timeout at all. When the dongle stops draining its USB CDC — which happens
    // when a peer floods the radio and the relay saturates the link — that wait
    // never returns. Caught on the kiosk with a thread parked in
    // tty_wait_until_sent while holding _sendLock, so every later "$LICENSE"
    // query queued behind it forever: the Wireless USB dialog sat on
    // "Checking…" indefinitely, and nothing was logged because nothing threw.
    // The flush bought nothing — the bytes are already on their way without it.

    /// <summary>
    /// How long to wait for another writer before giving up. Bounded so one
    /// stuck write cannot silently queue every later command behind it.
    /// </summary>
    private const int SendLockTimeoutMs = 3000;

    public virtual async Task SendRawAsync(string message)
    {
        if (_port is not { IsOpen: true })
            return;

        if (!await _sendLock.WaitAsync(SendLockTimeoutMs))
            throw new TimeoutException("Serial port is busy and did not accept the write");

        try
        {
            if (_port is not { IsOpen: true })
                return;

            var data = Encoding.UTF8.GetBytes(message + "\n");
            _port.Write(data, 0, data.Length);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    public virtual async Task SendMessageAsync<T>(T message, JsonTypeInfo<T> typeInfo)
    {
        if (_port is not { IsOpen: true })
            return;

        var json = JsonSerializer.Serialize(message, typeInfo);
        await SendRawAsync(json);
    }

    public void WriteRawBytes(byte[] data, int offset, int count)
    {
        if (_port is not { IsOpen: true })
            return;

        _port.Write(data, offset, count);
    }

    public static List<string> GetAvailablePorts()
    {
        try
        {
            return SerialPort.GetPortNames().ToList();
        }
        catch
        {
            return [];
        }
    }

    private async Task ReadLoopAsync(CancellationToken ct)
    {
        var buffer = new StringBuilder();
        var cancelled = false;
        var rawBuf = new byte[4096];

        try
        {
            while (!ct.IsCancellationRequested && _port?.IsOpen == true)
            {
                try
                {
                    var stream = _port.BaseStream;
                    var bytesRead = await stream.ReadAsync(rawBuf, 0, rawBuf.Length, ct);
                    if (bytesRead <= 0)
                    {
                        await Task.Delay(10, ct);
                        continue;
                    }

                    for (var i = 0; i < bytesRead; i++)
                    {
                        var b = rawBuf[i];

                        if (b == '\n')
                        {
                            var line = buffer.ToString().Trim();
                            buffer.Clear();
                            if (!string.IsNullOrEmpty(line))
                                ProcessMessage(line);
                        }
                        else if (b >= 0x20 && b <= 0x7E)
                        {
                            // Printable ASCII only
                            buffer.Append((char)b);
                        }
                        else if (b == '\t')
                        {
                            buffer.Append('\t');
                        }
                        else if (b != '\r')
                        {
                            // Non-printable byte (bootloader garbage) — discard buffer
                            buffer.Clear();
                        }
                    }
                }
                catch (TimeoutException) { }
                catch (OperationCanceledException) { throw; }
                catch (Exception) when (!ct.IsCancellationRequested)
                {
                    // IOException, UnauthorizedAccessException, InvalidOperationException
                    // all indicate the port is gone
                    break;
                }
            }
        }
        catch (OperationCanceledException) { cancelled = true; }

        // Fire disconnect for any non-cancellation exit (port unplugged, IO error, port closed)
        if (!cancelled && !ct.IsCancellationRequested)
        {
            // Mark dead before closing so IsConnected flips false the instant the
            // loop gives up, whatever the close does. Then release the handle:
            // holding a dead fd keeps the kernel's /dev/ttyACMn node alive, which
            // is why a self-resetting device re-enumerates onto a *different*
            // number instead of reclaiming its own. Not DisconnectAsync — that
            // awaits this very task and would deadlock.
            _readLoopDead = true;
            var port = _port;
            if (port is not null)
            {
                try { if (port.IsOpen) port.Close(); } catch { /* best effort */ }
            }
            PortDisconnected?.Invoke();
        }
    }

    private readonly object _bufferLock = new();
    private readonly StringBuilder _eventBuffer = new();

    private void OnDataReceived(object sender, SerialDataReceivedEventArgs e)
    {
        try
        {
            if (_port is not { IsOpen: true }) return;
            var data = _port.ReadExisting();

            lock (_bufferLock)
            {
                foreach (var ch in data)
                {
                    if (ch == '\n')
                    {
                        var line = _eventBuffer.ToString().Trim();
                        _eventBuffer.Clear();
                        if (line.Length > 0)
                            ProcessMessage(line);
                    }
                    else if (ch != '\r')
                    {
                        _eventBuffer.Append(ch);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Pendant DataReceived error: {Error}", ex.Message);
        }
    }

    private void ProcessMessage(string line)
    {
        // The multi-device dongle tags the pendant's frames "@pendant "; strip it so pendant
        // JSON/line handling is identical to the direct-USB path. Other "@name" (accessory)
        // frames pass through untouched to the addressed-device bridge.
        //
        // Exception: lines the dongle forwards as `@pendant $OTA:ACK …` (wireless OTA
        // acks from the pendant back to the host) need to REACH DongleDeviceService
        // .OnDongleLine to unblock DongleOtaService. Stripping the prefix here turns
        // them into a bare "$OTA:ACK …" line that OnRawMessage no longer recognises
        // as addressed traffic. Only strip when the remainder is JSON.
        if (line.StartsWith("@pendant ", StringComparison.Ordinal))
        {
            var rest = line.AsSpan("@pendant ".Length);
            if (rest.Length > 0 && rest[0] == '{')
                line = line.Substring("@pendant ".Length);
        }

        if (!line.StartsWith('{'))
        {
            RawMessageReceived?.Invoke(line);
            return;
        }

        try
        {
            var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;

            if (root.TryGetProperty("type", out var typeEl))
            {
                var type = typeEl.GetString();

                if (type == "pong" || type == "info")
                {
                    if (root.TryGetProperty("version", out var v))
                        DeviceVersion = v.GetString();
                    if (root.TryGetProperty("deviceId", out var d))
                        DeviceId = d.GetString();
                    if (root.TryGetProperty("model", out var m))
                        DeviceModel = m.GetString();
                    if (root.TryGetProperty("licensed", out var l) && l.ValueKind == JsonValueKind.True)
                        Licensed = true;
                }
            }

            MessageReceived?.Invoke(root);
        }
        catch (JsonException)
        {
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        _sendLock.Dispose();
        GC.SuppressFinalize(this);
    }
}
