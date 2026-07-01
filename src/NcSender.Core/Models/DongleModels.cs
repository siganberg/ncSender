using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

/// <summary>
/// A generic "addressed device" reachable through the ESP-NOW dongle. The dongle relays
/// each device's traffic to the host prefixed with "@&lt;name&gt; ". The host does not
/// interpret the payload — that's the accessory plugin's job. Core only tracks presence
/// and relays the raw last message.
/// </summary>
public class DongleDeviceInfo
{
    public string Name { get; set; } = "";

    /// <summary>True when a line from this device was seen recently (device linked).</summary>
    public bool Connected { get; set; }

    /// <summary>Milliseconds since the last line from this device (or -1 if never seen).</summary>
    public long LastSeenMs { get; set; } = -1;

    /// <summary>The raw last payload from the device (everything after "@name "), if any.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LastMessage { get; set; }
}

/// <summary>Body for POST /api/dongle/devices/{name}/send.</summary>
public record DongleSendRequest(string Payload);

/// <summary>WS event payload: a raw line arrived from an addressed device.</summary>
public class DongleDeviceMessage
{
    public string Name { get; set; } = "";
    public string Payload { get; set; } = "";
}

/// <summary>WS event payload: a device's connected state changed.</summary>
public class DongleDeviceChanged
{
    public string Name { get; set; } = "";
    public bool Connected { get; set; }
}
