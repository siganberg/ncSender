using System.Text.Json;
using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IProbeService
{
    Task<ProbeResult> StartAsync(Dictionary<string, JsonElement>? options, List<string>? commands);
    void Stop();
}
