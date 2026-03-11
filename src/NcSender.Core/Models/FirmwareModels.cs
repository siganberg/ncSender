using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

public class FirmwareData
{
    public string? Version { get; set; }
    public string? FirmwareVersion { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Timestamp { get; set; }

    public Dictionary<string, FirmwareSettingGroup> Groups { get; set; } = new();
    public Dictionary<string, FirmwareSetting> Settings { get; set; } = new();
}

public class FirmwareSettingGroup
{
    public int Id { get; set; }
    public int ParentId { get; set; }
    public string Name { get; set; } = "";
}

public class FirmwareSetting
{
    public int Id { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? GroupId { get; set; }

    public string Name { get; set; } = "";

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Unit { get; set; }

    public int DataType { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Format { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Min { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Max { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Value { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public FirmwareSettingGroup? Group { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? HalDetails { get; set; }
}
