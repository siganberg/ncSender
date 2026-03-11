using System.Net.WebSockets;

namespace NcSender.Server.WebSocket;

public class ClientConnection
{
    public string ClientId { get; }
    public System.Net.WebSockets.WebSocket Socket { get; }
    public string? Ip { get; init; }
    public bool IsLocal { get; init; }
    public string? Product { get; init; }
    public string? MachineId { get; init; }
    public string? Version { get; init; }
    public bool Licensed { get; init; }
    public bool PreferWifi { get; init; } = true;
    public DateTime ConnectedAt { get; } = DateTime.UtcNow;

    public ClientConnection(string clientId, System.Net.WebSockets.WebSocket socket)
    {
        ClientId = clientId;
        Socket = socket;
    }
}
