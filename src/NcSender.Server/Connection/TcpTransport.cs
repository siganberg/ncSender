using System.Net.Sockets;
using System.Text;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Connection;

public class TcpTransport : IConnectionTransport
{
    private readonly string _host;
    private readonly int _port;
    private TcpClient? _client;
    private NetworkStream? _stream;
    private CancellationTokenSource? _readCts;
    private Task? _readTask;

    public bool IsConnected => _client?.Connected == true;
    public string TransportType => "ethernet";

    public event Action<string>? LineReceived;
    public event Action<Exception?>? ConnectionLost;

    public TcpTransport(string host, int port)
    {
        _host = host;
        _port = port;
    }

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        _client = new TcpClient();
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(5));
        await _client.ConnectAsync(_host, _port, timeoutCts.Token);
        _stream = _client.GetStream();

        _readCts = new CancellationTokenSource();
        _readTask = ReadLoopAsync(_readCts.Token);
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

        _stream?.Dispose();
        _stream = null;

        _client?.Dispose();
        _client = null;

        _readCts?.Dispose();
        _readCts = null;
        _readTask = null;
    }

    public async Task WriteAsync(string data, CancellationToken ct = default)
    {
        if (_stream is null)
        {
            ConnectionLost?.Invoke(new IOException("TCP stream is not available"));
            throw new InvalidOperationException("TCP stream is not available");
        }

        try
        {
            var bytes = Encoding.ASCII.GetBytes(data);
            await _stream.WriteAsync(bytes, ct);
            await _stream.FlushAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            ConnectionLost?.Invoke(ex);
            throw;
        }
    }

    public async Task WriteRawAsync(byte[] data, CancellationToken ct = default)
    {
        if (_stream is null)
        {
            ConnectionLost?.Invoke(new IOException("TCP stream is not available"));
            throw new InvalidOperationException("TCP stream is not available");
        }

        try
        {
            await _stream.WriteAsync(data, ct);
            await _stream.FlushAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            ConnectionLost?.Invoke(ex);
            throw;
        }
    }

    private async Task ReadLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[4096];
        var lineBuffer = new StringBuilder();

        try
        {
            while (!ct.IsCancellationRequested)
            {
                var bytesRead = await _stream!.ReadAsync(buffer, ct);
                if (bytesRead == 0)
                {
                    // Connection closed gracefully
                    ConnectionLost?.Invoke(null);
                    return;
                }

                lineBuffer.Append(Encoding.ASCII.GetString(buffer, 0, bytesRead));

                // Strict newline framing (same approach as SerialTransport).
                // Everything up to the last '\n' is complete lines to dispatch;
                // anything after stays buffered for the next read.
                //
                // Do NOT reintroduce the previous "<-as-status-start" state
                // machine: PINSTATE labels legitimately contain '<-' (e.g.
                // "P3 <- Laser enable"), and treating that as an open status
                // frame would swallow the entire startup dump — PINSTATEs,
                // 'ok's, tool table, coord offsets — into one phantom "status
                // report" that only closed at the trailing '>' of a real
                // <Idle|...> minutes later. That was the ethernet-only bug
                // that made $I / $EG time out and blocked the user's first
                // Home click at launch.
                var buffered = lineBuffer.ToString();
                var lastNewline = buffered.LastIndexOf('\n');
                if (lastNewline < 0)
                    continue;

                var completeChunk = buffered[..(lastNewline + 1)];
                var remainder = buffered[(lastNewline + 1)..];
                lineBuffer.Clear();
                lineBuffer.Append(remainder);

                var linesToEmit = new List<string>();
                foreach (var raw in completeChunk.Split('\n'))
                {
                    var line = raw.TrimEnd('\r');
                    if (line.Length == 0)
                        continue;
                    TransportLineFramer.CollectLineWithStatusSplice(line, linesToEmit);
                }

                foreach (var line in linesToEmit)
                    LineReceived?.Invoke(line);
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown
        }
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}
