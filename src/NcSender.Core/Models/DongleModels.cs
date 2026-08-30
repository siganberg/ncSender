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

/// <summary>
/// The Wireless USB dongle's own license state, read via the "$LICENSE" line command.
/// Connected=false when no dongle is present (DeviceId/Licensed then meaningless).
/// </summary>
public record DongleLicenseStatus(bool Connected, bool Licensed, string DeviceId);

/// <summary>Body for POST /api/dongle/activate.</summary>
public record DongleActivateRequest(string InstallationId);

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

/// <summary>Body for POST /api/dongle/devices/{name}/ota-from-url.</summary>
public record DongleOtaFromUrlRequest(string DownloadUrl, string? DeviceId);

/// <summary>
/// WS event payload for plugin-ota:progress|message|error|done. Mirrors the
/// PluginOtaEvent used by USB OTA so plugins can consume both transports with
/// one subscription.
/// </summary>
public class DongleOtaEvent
{
    public string DeviceId { get; set; } = "";
    public string Device { get; set; } = "";  // the addressed @name
    public int? Percent { get; set; }
    public string? Type { get; set; }         // "info" | "warn" | "error"
    public string? Message { get; set; }
}

/// <summary>
/// Activation request for an accessory. The Installation ID is optional: with
/// it absent the server reactivates from the device fingerprint, which is what
/// a device already known to the store needs.
/// </summary>
public record AccessoryActivateRequest(string? InstallationId);

/// <summary>
/// <paramref name="NeedsInstallationId"/> means the store has never seen this
/// device, so the view should ask for an Installation ID and try again.
/// </summary>
public record AccessoryActivateResponse(bool Success, bool NeedsInstallationId, string? Error);
