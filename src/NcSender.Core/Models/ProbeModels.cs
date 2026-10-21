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

/// <summary>
/// What a probe run measured. Center probing reports the size between the
/// touched walls (mm, the probe tip accounted for); null when the routine
/// doesn't measure one.
/// </summary>
public class ProbeResult
{
    public double? MeasuredX { get; set; }
    public double? MeasuredY { get; set; }
}
