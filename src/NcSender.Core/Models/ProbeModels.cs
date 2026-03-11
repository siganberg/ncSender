using System.Text.Json;
using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

public class ProbeStartRequest
{
    public Dictionary<string, JsonElement>? Options { get; set; }
    public List<string>? Commands { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}
