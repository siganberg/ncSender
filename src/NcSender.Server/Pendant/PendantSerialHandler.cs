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

    public virtual bool IsConnected => _port?.IsOpen == true;
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

        _port = new SerialPort(port, 460800)
        {
            DtrEnable = true,
            RtsEnable = false,
            ReadTimeout = SerialPort.InfiniteTimeout,
            WriteTimeout = 5000
        };

        _port.Open();
        _readCts = new CancellationTokenSource();
        _readTask = ReadLoopAsync(_readCts.Token);

        _logger.LogInformation("Pendant serial connected on {Port}", port);
    }

    public async Task DisconnectAsync()
    {
        _readCts?.Cancel();

        if (_readTask is not null)
        {
            try { await _readTask; }
            catch (OperationCanceledException) { }
            catch { /* best effort */ }
        }

        var port = _port;
        _port = null;
        var hadPort = port is not null;

        if (port is not null)
        {
            try
            {
                if (port.IsOpen) port.Close();
            }
            catch { /* best effort */ }
            port.Dispose();
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

    public virtual async Task SendRawAsync(string message)
    {
        if (_port is not { IsOpen: true })
            return;

        await _sendLock.WaitAsync();
        try
        {
            if (_port is not { IsOpen: true })
                return;

            var data = Encoding.UTF8.GetBytes(message + "\n");
            _port.Write(data, 0, data.Length);
            _port.BaseStream.Flush();
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
        _port.BaseStream.Flush();
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
            PortDisconnected?.Invoke();
    }

    private void ProcessMessage(string line)
    {
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
