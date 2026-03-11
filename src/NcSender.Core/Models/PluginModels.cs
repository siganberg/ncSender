using System.Text.Json;
using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

public class PlatformsConverter : JsonConverter<Dictionary<string, string>>
{
    public override Dictionary<string, string> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.StartArray)
        {
            while (reader.Read() && reader.TokenType != JsonTokenType.EndArray) { }
            return new Dictionary<string, string>();
        }

        var dict = new Dictionary<string, string>();
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            var key = reader.GetString()!;
            reader.Read();
            dict[key] = reader.GetString()!;
        }
        return dict;
    }

    public override void Write(Utf8JsonWriter writer, Dictionary<string, string> value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        foreach (var kvp in value)
        {
            writer.WriteString(kvp.Key, kvp.Value);
        }
        writer.WriteEndObject();
    }
}

public class PluginManifest
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "";
    public string Author { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string MinAppVersion { get; set; } = "";
    public string Entry { get; set; } = "";
    public string Icon { get; set; } = "";
    public string Repository { get; set; } = "";
    [JsonConverter(typeof(PlatformsConverter))]
    public Dictionary<string, string> Platforms { get; set; } = new();
    public List<string> Events { get; set; } = [];
    public List<string> Permissions { get; set; } = [];
    public string Commands { get; set; } = "";
    public string ConfigUi { get; set; } = "";
    public int Priority { get; set; }
    public List<PluginToolMenuEntry> ToolMenu { get; set; } = [];
    public Dictionary<string, PluginMessageConfig> Messages { get; set; } = new();
}

public class PluginMessageConfig
{
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public string ContinueLabel { get; set; } = "Continue";
}

public class PluginDialogInfo
{
    public string PluginId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public string ContinueLabel { get; set; } = "Continue";
    public string AbortEventGcode { get; set; } = "";
}

public class PluginToolMenuEntry
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string Icon { get; set; } = "";
    public bool ClientOnly { get; set; }
}

public class PluginRegistryEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "";
    public string Category { get; set; } = "";
    public bool Enabled { get; set; }
    public string InstalledAt { get; set; } = "";
    public int Priority { get; set; }
    public string Repository { get; set; } = "";
}

public class PluginToolMenuItem
{
    public string Id { get; set; } = "";
    public string PluginId { get; set; } = "";
    public string Label { get; set; } = "";
    public string Icon { get; set; } = "";
    public bool ClientOnly { get; set; }
}

public class PluginInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "";
    public string Author { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public bool Enabled { get; set; }
    public int Priority { get; set; }
    public string Icon { get; set; } = "";
    public bool HasIcon { get; set; }
    public string Repository { get; set; } = "";
    public string ConfigUi { get; set; } = "";
    public DateTime InstalledAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public PluginManifest? Manifest { get; set; }
}

public class PluginUpdateInfo
{
    [JsonPropertyName("hasUpdate")]
    public bool UpdateAvailable { get; set; }
    public string CurrentVersion { get; set; } = "";
    public string LatestVersion { get; set; } = "";
    public string DownloadUrl { get; set; } = "";
    public string ReleaseNotes { get; set; } = "";
    public string ReleaseUrl { get; set; } = "";
    public string? PublishedAt { get; set; }
}
