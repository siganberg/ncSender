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
    private Thread? _readThread;

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
            ReadBufferSize = 65536,
            ReadTimeout = 1000,
            WriteTimeout = 5000
        };

        _port.Open();

        // On Linux, force raw mode via stty to match node.js serialport behavior.
        // .NET SerialPort may leave suboptimal termios settings that cause the kernel
        // to batch data, leading to USB CDC buffer overflow on fast controllers.
        if (!OperatingSystem.IsWindows())
        {
            try
            {
                using var stty = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "stty",
                    Arguments = $"-F {_portPath} raw -echo -echoe -echok {_baudRate}",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                stty?.WaitForExit(2000);
            }
            catch (Exception ex)
            {
                Logger.Debug("stty raw mode failed (non-fatal): {Error}", ex.Message);
            }
        }

        // Use a dedicated thread with blocking reads for lowest possible latency.
        // ReadAsync through the thread pool has scheduling delays that can cause
        // USB CDC buffer overflows on Linux (Pi 5) during high-throughput bursts.
        _readCts = new CancellationTokenSource();
        _readThread = new Thread(() => ReadLoop(_readCts.Token))
        {
            Name = "SerialRead",
            IsBackground = true
        };
        _readThread.Start();

        return Task.CompletedTask;
    }

    public Task DisconnectAsync()
    {
        // Signal read thread to stop
        _readCts?.Cancel();

        var port = _port;
        _port = null;

        // Close port first — this unblocks any blocking Read() in the read thread
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

        // Wait for read thread to finish
        if (_readThread is not null)
        {
            _readThread.Join(TimeSpan.FromSeconds(2));
            _readThread = null;
        }

        _readCts?.Dispose();
        _readCts = null;

        return Task.CompletedTask;
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

    private void ReadLoop(CancellationToken ct)
    {
        var buffer = new byte[4096];

        try
        {
            while (!ct.IsCancellationRequested && _port is { IsOpen: true })
            {
                int bytesRead;
                try
                {
                    // Blocking read — wakes as soon as data arrives (no thread pool delay).
                    // ReadTimeout is set to 1000ms so we periodically check cancellation.
                    bytesRead = _port.Read(buffer, 0, buffer.Length);
                }
                catch (TimeoutException)
                {
                    // ReadTimeout expired — loop back to check cancellation and port state
                    continue;
                }
                catch (IOException)
                {
                    // Port closed or disconnected
                    break;
                }
                catch (InvalidOperationException)
                {
                    // Port was closed
                    break;
                }

                if (bytesRead == 0)
                    continue;

                var data = Encoding.ASCII.GetString(buffer, 0, bytesRead);
                ProcessIncomingData(data);
            }
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
