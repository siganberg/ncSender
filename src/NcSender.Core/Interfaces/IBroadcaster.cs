using System.Text.Json;

namespace NcSender.Core.Interfaces;

public interface IBroadcaster
{
    /// <summary>
    /// Broadcast a message to all connected WebSocket clients.
    /// </summary>
    Task Broadcast(string type, JsonElement data);

    /// <summary>
    /// Send a message to a specific client by ID.
    /// </summary>
    Task SendToClient(string clientId, string type, JsonElement data);
}
