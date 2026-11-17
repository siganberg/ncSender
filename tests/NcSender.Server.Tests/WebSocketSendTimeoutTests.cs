using NcSender.Server.WebSocket;

namespace NcSender.Server.Tests;

public class WebSocketSendTimeoutTests
{
    // Small frames keep the 250 ms stall guard; a plugin dialog's HTML
    // (over 1 MB) gets time to cross Wi-Fi instead of dropping the client.
    [Theory]
    [InlineData(0, 250)]
    [InlineData(200, 250)]
    [InlineData(64 * 1024, 314)]
    [InlineData(1_250_000, 1470)]
    [InlineData(50_000_000, 10_000)]
    public void Timeout_grows_with_the_frame(int bytes, int expectedMs)
    {
        Assert.Equal(expectedMs, WebSocketLayer.SendTimeoutFor(bytes));
    }
}
