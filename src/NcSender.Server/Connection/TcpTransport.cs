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
        var statusBuffer = new StringBuilder();
        var inStatus = false;

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

                var text = Encoding.ASCII.GetString(buffer, 0, bytesRead);
                foreach (var ch in text)
                {
                    // `?` real-time polls (every 100ms) can splice a <...> status
                    // report into the middle of a long response like $ES. Keep the
                    // partial regular line intact across the splice by routing the
                    // status report into its own buffer rather than flushing what
                    // was being assembled.
                    if (inStatus)
                    {
                        statusBuffer.Append(ch);
                        if (ch == '>')
                        {
                            LineReceived?.Invoke(statusBuffer.ToString());
                            statusBuffer.Clear();
                            inStatus = false;
                        }
                        continue;
                    }

                    if (ch == '<')
                    {
                        statusBuffer.Append(ch);
                        inStatus = true;
                    }
                    else if (ch == '\n')
                    {
                        var line = lineBuffer.ToString().TrimEnd('\r');
                        lineBuffer.Clear();
                        if (line.Length > 0)
                            LineReceived?.Invoke(line);
                    }
                    else
                    {
                        lineBuffer.Append(ch);
                    }
                }
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
