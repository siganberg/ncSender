using System.Text.Json;
using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

/// <summary>
/// Reads int IDs from JSON, gracefully handling legacy GUID strings by returning 0 (for reassignment).
/// </summary>
public class IntOrStringIdConverter : JsonConverter<int>
{
    public override int Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Number)
            return reader.GetInt32();
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (int.TryParse(str, out var result))
                return result;
            return 0;
        }
        return 0;
    }

    public override void Write(Utf8JsonWriter writer, int value, JsonSerializerOptions options)
    {
        writer.WriteNumberValue(value);
    }
}

public class ToolInfo
{
    [JsonConverter(typeof(IntOrStringIdConverter))]
    public int Id { get; set; }
    public int? ToolId { get; set; }
    public int? ToolNumber { get; set; }
    public string Name { get; set; } = "";
    public string Type { get; set; } = "flat";
    public double Diameter { get; set; }

    public ToolOffsets Offsets { get; set; } = new();

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, JsonElement>? Metadata { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ToolDimensions? Dimensions { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ToolSpecs? Specs { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ToolLife? Life { get; set; }
}

public class ToolOffsets
{
    public double Tlo { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }
}

public class ToolDimensions
{
    [JsonPropertyName("flute_length")]
    public double? FluteLength { get; set; }

    [JsonPropertyName("overall_length")]
    public double? OverallLength { get; set; }

    [JsonPropertyName("taper_angle")]
    public double? TaperAngle { get; set; }

    public double? Radius { get; set; }
    public double? Stickout { get; set; }
}

public class ToolSpecs
{
    public string? Material { get; set; }
    public string? Coating { get; set; }
}

public class ToolLife
{
    public bool Enabled { get; set; }

    [JsonPropertyName("total_minutes")]
    public double? TotalMinutes { get; set; }

    [JsonPropertyName("used_minutes")]
    public double UsedMinutes { get; set; }

    [JsonPropertyName("remaining_minutes")]
    public double? RemainingMinutes { get; set; }

    [JsonPropertyName("usage_count")]
    public int UsageCount { get; set; }
}
