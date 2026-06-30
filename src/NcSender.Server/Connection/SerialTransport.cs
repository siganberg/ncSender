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
    private readonly StringBuilder _statusBuffer = new();
    private bool _inStatus;
    private readonly object _bufferLock = new();

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

        // DTR/RTS set at creation so the port opens with them already high —
        // no transition after open. A post-open DTR toggle resets ESP32 (FluidNC).
        // grblHAL needs DTR for USB CDC communication; FluidNC is fine with DTR
        // already high at open (its overrun errors are handled non-fatally).
        _port = new SerialPort(_portPath, _baudRate)
        {
            DtrEnable = true,
            RtsEnable = true,
            ReadTimeout = SerialPort.InfiniteTimeout,
            WriteTimeout = 5000
        };

        _port.DataReceived += OnDataReceived;
        _port.ErrorReceived += OnErrorReceived;

        _port.Open();
        return Task.CompletedTask;
    }

    public Task DisconnectAsync()
    {
        var port = _port;
        _port = null;

        if (port is not null)
        {
            port.DataReceived -= OnDataReceived;
            port.ErrorReceived -= OnErrorReceived;

            try
            {
                if (port.IsOpen)
                    port.Close();
            }
            catch { /* best effort */ }

            port.Dispose();
        }

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

    private void OnDataReceived(object sender, SerialDataReceivedEventArgs e)
    {
        try
        {
            if (_port is not { IsOpen: true })
                return;

            var data = _port.ReadExisting();

            // SerialPort.DataReceived can fire concurrently on multiple thread pool threads.
            // Lock to prevent _lineBuffer corruption which can cause lost ok/error responses.
            lock (_bufferLock)
            {
                foreach (var ch in data)
                {
                    // `?` real-time polls (every 100ms) can splice a <...> status
                    // report into the middle of a long response like $ES. Keep the
                    // partial regular line intact across the splice by routing the
                    // status report into its own buffer rather than flushing what
                    // was being assembled.
                    if (_inStatus)
                    {
                        _statusBuffer.Append(ch);
                        if (ch == '>')
                        {
                            LineReceived?.Invoke(_statusBuffer.ToString());
                            _statusBuffer.Clear();
                            _inStatus = false;
                        }
                        continue;
                    }

                    if (ch == '<')
                    {
                        _statusBuffer.Append(ch);
                        _inStatus = true;
                    }
                    else if (ch == '\n')
                    {
                        var line = _lineBuffer.ToString().TrimEnd('\r');
                        _lineBuffer.Clear();
                        if (line.Length > 0)
                            LineReceived?.Invoke(line);
                    }
                    else
                    {
                        _lineBuffer.Append(ch);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
        }
    }

    private void OnErrorReceived(object sender, SerialErrorReceivedEventArgs e)
    {
        if (e.EventType is SerialError.Overrun or SerialError.RXOver)
        {
            Logger.Warning("Serial buffer overrun on {Port} (non-fatal, continuing)", _portPath);
            return;
        }

        ConnectionLost?.Invoke(new IOException($"Serial error: {e.EventType}"));
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}
