using System.Text.Json;

namespace NcSender.Core.Interfaces;

public interface IProbeService
{
    Task StartAsync(Dictionary<string, JsonElement>? options, List<string>? commands);
    void Stop();
}
