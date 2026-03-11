using System.Text.Json;

namespace NcSender.Core.Interfaces;

public interface IJogManager
{
    Task HandleMessageAsync(string clientId, string type, JsonElement data);
    Task HandleDisconnectAsync(string clientId);
}
