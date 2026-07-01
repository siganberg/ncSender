using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

/// <summary>
/// Status of the "autodustboot" ESP-NOW device that pairs through the same dongle as
/// the pendant. Populated from the device's periodic "status …" line, which the dongle
/// relays to the host prefixed with "@autodustboot ".
/// </summary>
public class AutoDustBootStatus
{
    /// <summary>True when an @autodustboot line was seen recently (device linked via the dongle).</summary>
    public bool Connected { get; set; }

    /// <summary>Milliseconds since the last @autodustboot line (or -1 if never seen).</summary>
    public long LastSeenMs { get; set; } = -1;

    /// <summary>Latest device state: "home" | "moving" | "expanded" (from the status line), if known.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? State { get; set; }

    /// <summary>Latest position (counts from home).</summary>
    public long Pos { get; set; }

    /// <summary>Latest saved (expanded) position.</summary>
    public long Saved { get; set; }

    /// <summary>True once a homing run has succeeded.</summary>
    public bool Homed { get; set; }
}

/// <summary>Body for POST /api/autodustboot/command — the raw device command (e.g. "home", "up", "goto:0").</summary>
public record AutoDustBootCommandRequest(string Command);
