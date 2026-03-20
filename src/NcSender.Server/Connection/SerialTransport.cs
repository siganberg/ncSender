using System.Diagnostics;
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
    private readonly StringBuilder _lineBuffer = new();
    private CancellationTokenSource? _readCts;
    private Thread? _readThread;

    // Windows: use SerialPort. Linux/macOS: use direct FileStream + stty.
    private SerialPort? _port;
    private FileStream? _fileStream;
    private bool _useDirectIO;
    private volatile bool _isConnected;

    public bool IsConnected => _isConnected;
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

        _useDirectIO = !OperatingSystem.IsWindows();

        if (_useDirectIO)
            OpenDirectIO();
        else
            OpenSerialPort();

        _isConnected = true;

        _readCts = new CancellationTokenSource();
        _readThread = new Thread(() => ReadLoop(_readCts.Token))
        {
            Name = "SerialRead",
            IsBackground = true
        };
        _readThread.Start();

        return Task.CompletedTask;
    }

    private void OpenDirectIO()
    {
        // Configure port via stty before opening — matches node.js serialport behavior.
        // This sets raw mode, baud rate, and DTR/RTS in one call.
        var sttyArgs = $"-F {_portPath} {_baudRate} raw -echo -echoe -echok cs8 -cstopb cread clocal -crtscts -hupcl";
        try
        {
            using var stty = Process.Start(new ProcessStartInfo
            {
                FileName = "stty",
                Arguments = sttyArgs,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            stty?.WaitForExit(2000);
            if (stty?.ExitCode != 0)
            {
                var stderr = stty?.StandardError.ReadToEnd();
                Logger.Warning("stty exited with code {Code}: {Error}", stty?.ExitCode, stderr);
            }
        }
        catch (Exception ex)
        {
            Logger.Warning("stty failed, falling back to SerialPort: {Error}", ex.Message);
            _useDirectIO = false;
            OpenSerialPort();
            return;
        }

        // Open as a regular file — the kernel handles serial I/O via the tty driver.
        // FileOptions.None avoids .NET adding async I/O overhead.
        _fileStream = new FileStream(_portPath, FileMode.Open, FileAccess.ReadWrite,
            FileShare.ReadWrite, bufferSize: 4096, FileOptions.None);

        // Assert DTR by writing to the control line (stty hupcl handles this on close)
        try
        {
            using var dtr = Process.Start(new ProcessStartInfo
            {
                FileName = "stty",
                Arguments = $"-F {_portPath} hupcl",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            dtr?.WaitForExit(1000);
        }
        catch { /* non-fatal */ }
    }

    private void OpenSerialPort()
    {
        _port = new SerialPort(_portPath, _baudRate)
        {
            DtrEnable = true,
            RtsEnable = true,
            ReadBufferSize = 65536,
            ReadTimeout = 1000,
            WriteTimeout = 5000
        };
        _port.Open();
    }

    public Task DisconnectAsync()
    {
        _isConnected = false;
        _readCts?.Cancel();

        if (_useDirectIO)
        {
            var stream = _fileStream;
            _fileStream = null;
            try { stream?.Close(); } catch { /* best effort */ }
            try { stream?.Dispose(); } catch { /* best effort */ }
        }
        else
        {
            var port = _port;
            _port = null;
            try { if (port?.IsOpen == true) port.Close(); } catch { /* best effort */ }
            try { port?.Dispose(); } catch { /* best effort */ }
        }

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
        if (!_isConnected)
        {
            ConnectionLost?.Invoke(new IOException("Serial port is not open"));
            throw new InvalidOperationException("Serial port is not open");
        }

        try
        {
            if (_useDirectIO && _fileStream is not null)
            {
                var bytes = Encoding.ASCII.GetBytes(data);
                _fileStream.Write(bytes, 0, bytes.Length);
                _fileStream.Flush();
            }
            else if (_port is { IsOpen: true })
            {
                _port.Write(data);
            }
            else
            {
                throw new InvalidOperationException("Serial port is not open");
            }
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
        if (!_isConnected)
        {
            ConnectionLost?.Invoke(new IOException("Serial port is not open"));
            throw new InvalidOperationException("Serial port is not open");
        }

        try
        {
            if (_useDirectIO && _fileStream is not null)
            {
                _fileStream.Write(data, 0, data.Length);
                _fileStream.Flush();
            }
            else if (_port is { IsOpen: true })
            {
                _port.Write(data, 0, data.Length);
            }
            else
            {
                throw new InvalidOperationException("Serial port is not open");
            }
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
            while (!ct.IsCancellationRequested && _isConnected)
            {
                int bytesRead;
                try
                {
                    if (_useDirectIO && _fileStream is not null)
                    {
                        // Direct read from file descriptor — lowest latency, no .NET overhead.
                        // Blocks until data arrives (raw mode: VMIN=1, VTIME=0).
                        bytesRead = _fileStream.Read(buffer, 0, buffer.Length);
                    }
                    else if (_port is { IsOpen: true })
                    {
                        bytesRead = _port.Read(buffer, 0, buffer.Length);
                    }
                    else
                    {
                        break;
                    }
                }
                catch (TimeoutException)
                {
                    continue;
                }
                catch (IOException)
                {
                    break;
                }
                catch (InvalidOperationException)
                {
                    break;
                }

                if (bytesRead == 0)
                {
                    // EOF on Linux means port was closed/disconnected
                    if (_useDirectIO) break;
                    continue;
                }

                var data = Encoding.ASCII.GetString(buffer, 0, bytesRead);
                ProcessIncomingData(data);
            }
        }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
                ConnectionLost?.Invoke(ex);
        }

        if (!ct.IsCancellationRequested && _isConnected)
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
