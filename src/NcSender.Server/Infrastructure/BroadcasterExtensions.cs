using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Infrastructure;

public static class BroadcasterExtensions
{
    public static Task Broadcast<T>(this IBroadcaster broadcaster, string type, T data, JsonTypeInfo<T> typeInfo)
    {
        var element = JsonSerializer.SerializeToElement(data, typeInfo);
        return broadcaster.Broadcast(type, element);
    }

    public static Task SendToClient<T>(this IBroadcaster broadcaster, string clientId, string type, T data, JsonTypeInfo<T> typeInfo)
    {
        var element = JsonSerializer.SerializeToElement(data, typeInfo);
        return broadcaster.SendToClient(clientId, type, element);
    }
}
