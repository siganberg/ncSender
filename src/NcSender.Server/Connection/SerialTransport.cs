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

            List<string> linesToEmit;
            // SerialPort.DataReceived can fire concurrently on multiple thread
            // pool threads. Lock while we mutate the shared buffer, but do the
            // event dispatch OUTSIDE the lock so downstream handlers don't
            // hold the framer serialized.
            lock (_bufferLock)
            {
                _lineBuffer.Append(data);

                // Strict newline framing. Everything up to the last '\n' is
                // complete lines to dispatch; anything after stays buffered
                // for the next read. This avoids the earlier <-as-status-start
                // trick that would swallow entire bursts (PINSTATE lines,
                // `ok`s, etc.) into a single "status" buffer whenever a stray
                // '<' appeared before a distant '>' — the exact framing bug
                // that hid "ok" responses and made the controller look stuck.
                var buffered = _lineBuffer.ToString();
                var lastNewline = buffered.LastIndexOf('\n');
                if (lastNewline < 0)
                    return;

                var completeChunk = buffered[..(lastNewline + 1)];
                var remainder = buffered[(lastNewline + 1)..];
                _lineBuffer.Clear();
                _lineBuffer.Append(remainder);

                linesToEmit = new List<string>();
                foreach (var raw in completeChunk.Split('\n'))
                {
                    var line = raw.TrimEnd('\r');
                    if (line.Length == 0)
                        continue;
                    TransportLineFramer.CollectLineWithStatusSplice(line, linesToEmit);
                }
            }

            foreach (var line in linesToEmit)
                LineReceived?.Invoke(line);
        }
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
        }
    }

    // Handles the edge case where a `?` realtime status poll splices its
    // <...> report inline with another response on the same physical line.
    // Emit the status report as its own event, plus any prefix / suffix
    // as their own line events so downstream parsers see clean input.
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
