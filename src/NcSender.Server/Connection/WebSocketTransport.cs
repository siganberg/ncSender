using System.Net.WebSockets;
using System.Text;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Connection;

public class WebSocketTransport : IConnectionTransport
{
    private readonly string _host;
    private readonly int _port;
    private ClientWebSocket? _ws;
    private CancellationTokenSource? _readCts;
    private Task? _readTask;

    public bool IsConnected => _ws?.State == WebSocketState.Open;
    public string TransportType => "websocket";

    public event Action<string>? LineReceived;
    public event Action<Exception?>? ConnectionLost;

    public WebSocketTransport(string host, int port)
    {
        _host = host;
        _port = port;
    }

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        _ws = new ClientWebSocket();
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(5));

        var uri = new Uri($"ws://{_host}:{_port}/");
        await _ws.ConnectAsync(uri, timeoutCts.Token);

        _readCts = new CancellationTokenSource();
        _readTask = ReadLoopAsync(_readCts.Token);
    }

    public async Task DisconnectAsync()
    {
        _readCts?.Cancel();

        if (_ws?.State == WebSocketState.Open)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disconnecting", cts.Token);
            }
            catch { /* best effort */ }
        }

        if (_readTask is not null)
        {
            try { await _readTask; }
            catch (OperationCanceledException) { }
            catch { /* best effort */ }
        }

        _ws?.Dispose();
        _ws = null;

        _readCts?.Dispose();
        _readCts = null;
        _readTask = null;
    }

    public async Task WriteAsync(string data, CancellationToken ct = default)
    {
        if (_ws?.State != WebSocketState.Open)
        {
            ConnectionLost?.Invoke(new IOException("WebSocket is not open"));
            throw new InvalidOperationException("WebSocket is not open");
        }

        try
        {
            var bytes = Encoding.ASCII.GetBytes(data);
            await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            ConnectionLost?.Invoke(ex);
            throw;
        }
    }

    public async Task WriteRawAsync(byte[] data, CancellationToken ct = default)
    {
        if (_ws?.State != WebSocketState.Open)
        {
            ConnectionLost?.Invoke(new IOException("WebSocket is not open"));
            throw new InvalidOperationException("WebSocket is not open");
        }

        try
        {
            await _ws.SendAsync(data, WebSocketMessageType.Binary, true, ct);
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
            while (!ct.IsCancellationRequested && _ws?.State == WebSocketState.Open)
            {
                var result = await _ws.ReceiveAsync(buffer, ct);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    ConnectionLost?.Invoke(null);
                    return;
                }

                var text = Encoding.ASCII.GetString(buffer, 0, result.Count);
                var lines = text.Split('\n');
                foreach (var rawLine in lines)
                {
                    var line = rawLine.Trim();
                    if (line.Length > 0)
                        LineReceived?.Invoke(line);
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
