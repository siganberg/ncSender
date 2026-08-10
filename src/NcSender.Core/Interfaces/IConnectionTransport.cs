namespace NcSender.Core.Interfaces;

public interface IConnectionTransport : IAsyncDisposable
{
    bool IsConnected { get; }
    string TransportType { get; }
    // Serial port path for usb transports (/dev/ttyACM0, COM3, etc.);
    // remote URI or empty for other transport types. Consumers use this
    // to reserve the CNC port during USB serial probes so they don't
    // accidentally open it (which resets ESP32/STM32 boards via DTR).
    string PortPath { get; }

    Task ConnectAsync(CancellationToken ct = default);
    Task DisconnectAsync();
    Task WriteAsync(string data, CancellationToken ct = default);
    Task WriteRawAsync(byte[] data, CancellationToken ct = default);

    event Action<string> LineReceived;
    event Action<Exception?> ConnectionLost;
}
