using System.IO.Ports;
using System.Text;
using NcSender.Core.Interfaces;
using Serilog;

namespace NcSender.Server.Connection;

public class SerialTransport : IConnectionTransport
{
    private static readonly Serilog.ILogger Logger = Log.ForContext<SerialTransport>();

    private readonly string _portPath;
    private readonly int _baudRate;
    private SerialPort? _port;
    private readonly StringBuilder _lineBuffer = new();
    private CancellationTokenSource? _readCts;
    private Task? _readTask;

    public bool IsConnected => _port?.IsOpen == true;
    public string TransportType => "usb";
    public string PortPath => _portPath;

    public event Action<string>? LineReceived;
    public event Action<Exception?>? ConnectionLost;

    public SerialTransport(string portPath, int baudRate)
    {
        _portPath = portPath;
        _baudRate = baudRate;
    }

    public Task ConnectAsync(CancellationToken ct = default)
    {
        Logger.Debug("Opening serial port {Path} at {BaudRate} baud", _portPath, _baudRate);

        _port = new SerialPort(_portPath, _baudRate)
        {
            DtrEnable = true,
            RtsEnable = true,
            ReadTimeout = SerialPort.InfiniteTimeout,
            WriteTimeout = 5000
        };

        _port.Open();

        // Use a dedicated read loop instead of DataReceived event.
        // DataReceived is unreliable on Linux/.NET — it can miss data,
        // deliver partial reads, or not fire at all on some platforms (Pi 5).
        _readCts = new CancellationTokenSource();
        _readTask = Task.Run(() => ReadLoopAsync(_readCts.Token));

        return Task.CompletedTask;
    }

    public async Task DisconnectAsync()
    {
        // Stop read loop first
        if (_readCts is not null)
        {
            await _readCts.CancelAsync();
            try
            {
                if (_readTask is not null)
                    await _readTask.WaitAsync(TimeSpan.FromSeconds(2));
            }
            catch { /* timeout or cancelled — expected */ }

            _readCts.Dispose();
            _readCts = null;
            _readTask = null;
        }

        var port = _port;
        _port = null;

        if (port is not null)
        {
            try
            {
                if (port.IsOpen)
                    port.Close();
            }
            catch { /* best effort */ }

            port.Dispose();
        }
    }

    public Task WriteAsync(string data, CancellationToken ct = default)
    {
        if (_port is not { IsOpen: true })
        {
            ConnectionLost?.Invoke(new IOException("Serial port is not open"));
            throw new InvalidOperationException("Serial port is not open");
        }

        try
        {
            _port.Write(data);
        }
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
            throw;
        }
        return Task.CompletedTask;
    }

    public Task WriteRawAsync(byte[] data, CancellationToken ct = default)
    {
        if (_port is not { IsOpen: true })
        {
            ConnectionLost?.Invoke(new IOException("Serial port is not open"));
            throw new InvalidOperationException("Serial port is not open");
        }

        try
        {
            _port.Write(data, 0, data.Length);
        }
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
            throw;
        }
        return Task.CompletedTask;
    }

    private async Task ReadLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[4096];

        try
        {
            var stream = _port?.BaseStream;
            if (stream is null) return;

            while (!ct.IsCancellationRequested && _port is { IsOpen: true })
            {
                int bytesRead;
                try
                {
                    // Use a linked timeout so we periodically check if the port is still alive.
                    // On Linux, ReadAsync can hang indefinitely if the USB cable is disconnected.
                    using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    timeoutCts.CancelAfter(5000);
                    bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length, timeoutCts.Token);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    // Read timeout — check if port is still open and retry
                    if (_port is not { IsOpen: true })
                        break;
                    continue;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (IOException)
                {
                    // Port closed or disconnected
                    break;
                }

                // bytesRead == 0 on serial BaseStream means the port was closed
                if (bytesRead == 0)
                    break;

                // Decode bytes to chars and process
                var data = Encoding.ASCII.GetString(buffer, 0, bytesRead);
                ProcessIncomingData(data);
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown
        }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
                ConnectionLost?.Invoke(ex);
        }

        // If we exited the loop unexpectedly (not from cancellation), signal connection lost
        if (!ct.IsCancellationRequested && _port is not null)
            ConnectionLost?.Invoke(new IOException("Serial port read loop ended unexpectedly"));
    }

    private void ProcessIncomingData(string data)
    {
        foreach (var ch in data)
        {
            if (ch == '\n')
            {
                var line = _lineBuffer.ToString().TrimEnd('\r');
                _lineBuffer.Clear();
                if (line.Length > 0)
                    LineReceived?.Invoke(line);
            }
            else if (ch == '<')
            {
                // Status reports can be injected mid-line by GRBL real-time commands.
                // Flush any partial line before starting the status report.
                if (_lineBuffer.Length > 0)
                {
                    var partial = _lineBuffer.ToString().TrimEnd('\r');
                    _lineBuffer.Clear();
                    if (partial.Length > 0)
                        LineReceived?.Invoke(partial);
                }
                _lineBuffer.Append(ch);
            }
            else if (ch == '>' && _lineBuffer.Length > 0 && _lineBuffer[0] == '<')
            {
                _lineBuffer.Append(ch);
                var line = _lineBuffer.ToString();
                _lineBuffer.Clear();
                LineReceived?.Invoke(line);
            }
            else
            {
                _lineBuffer.Append(ch);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}
