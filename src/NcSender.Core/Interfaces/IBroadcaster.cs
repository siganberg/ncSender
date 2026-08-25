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

    /// <summary>
    /// Fires after every <see cref="Broadcast"/>. Lets non-WebSocket surfaces
    /// (pendant, future remotes) observe the same message stream browsers see.
    /// Subscribers must not block — the raise happens on the broadcast path.
    /// </summary>
    event Action<string, JsonElement>? MessageBroadcast;
}
