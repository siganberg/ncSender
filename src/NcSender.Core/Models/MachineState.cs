using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

public class MachineState
{
    public bool Connected { get; set; }
    public bool IsToolChanging { get; set; }
    public bool IsProbing { get; set; }
    public int? HomingCycle { get; set; }
    public double MaxFeedrate { get; set; }
    public double MaxFeedrateX { get; set; }
    public double MaxFeedrateY { get; set; }
    public double MaxFeedrateZ { get; set; }

    // GRBL status report fields
    public string Status { get; set; } = "Unknown";
    public bool Homed { get; set; }
    public string Workspace { get; set; } = "G54";
    public int Tool { get; set; }
    public bool ToolLengthSet { get; set; }
    public bool SpindleActive { get; set; }
    public bool FloodCoolant { get; set; }
    public bool MistCoolant { get; set; }
    public double FeedrateOverride { get; set; } = 100;
    public double RapidOverride { get; set; } = 100;
    public double SpindleOverride { get; set; } = 100;
    public int ActiveProbe { get; set; }

    // GRBL protocol fields — preserve exact casing for V1 client compatibility
    [JsonPropertyName("Pn")]
    public string Pn { get; set; } = "";

    // Individual feed/spindle fields
    public double FeedRate { get; set; }
    public double SpindleRpmTarget { get; set; }
    public double SpindleRpmActual { get; set; }

    // Axes info
    public string? Axes { get; set; }
    public int AxisCount { get; set; }

    // Positions — stored as comma-separated strings to match V1 format
    // V1 client does MPos.split(',').map(Number)
    [JsonPropertyName("MPos")]
    public string MPos { get; set; } = "0,0,0";

    [JsonPropertyName("WPos")]
    public string WPos { get; set; } = "0,0,0";

    [JsonPropertyName("WCO")]
    public string WCO { get; set; } = "0,0,0";

    // Computed FS array for JSON serialization compat with V1 clients
    [JsonPropertyName("FS")]
    public double[] FS => [FeedRate, SpindleRpmTarget, SpindleRpmActual];

    [JsonPropertyName("Bf")]
    public int[] Bf { get; set; } = [0, 0]; // [planBuffer, rxBuffer]

    [JsonPropertyName("Ln")]
    public int Ln { get; set; }

    // Work coordinate offsets (G54-G59) — comma-separated strings from $# response
    [JsonPropertyName("g54")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? G54 { get; set; }

    [JsonPropertyName("g55")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? G55 { get; set; }

    [JsonPropertyName("g56")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? G56 { get; set; }

    [JsonPropertyName("g57")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? G57 { get; set; }

    [JsonPropertyName("g58")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? G58 { get; set; }

    [JsonPropertyName("g59")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? G59 { get; set; }

    public int OutputPins { get; set; }
    public List<int> OutputPinsState { get; set; } = [];

    // Alarm info (set when status is Alarm)
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? AlarmCode { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AlarmDescription { get; set; }
}

