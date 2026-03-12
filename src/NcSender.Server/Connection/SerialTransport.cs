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
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
        }
    }

    private void OnErrorReceived(object sender, SerialErrorReceivedEventArgs e)
    {
        ConnectionLost?.Invoke(new IOException($"Serial error: {e.EventType}"));
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}
