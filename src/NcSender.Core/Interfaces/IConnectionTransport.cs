namespace NcSender.Core.Interfaces;

public interface IConnectionTransport : IAsyncDisposable
{
    bool IsConnected { get; }
    string TransportType { get; }

    Task ConnectAsync(CancellationToken ct = default);
    Task DisconnectAsync();
    Task WriteAsync(string data, CancellationToken ct = default);
    Task WriteRawAsync(byte[] data, CancellationToken ct = default);

    event Action<string> LineReceived;
    event Action<Exception?> ConnectionLost;
}
