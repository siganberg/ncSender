using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

public class PendantStatus
{
    public string ConnectionState { get; set; } = "disconnected";

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public PendantDeviceInfo? UsbPendant { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public PendantDeviceInfo? WifiPendant { get; set; }

    public bool PendantEnabled { get; set; }
    public string ActiveConnectionType { get; set; } = "none";

    /// <summary>V1 client reads this field for the toolbar pendant icon.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PendantConnectionType { get; set; }

    /// <summary>True when a direct USB connection is available for OTA firmware flashing.</summary>
    public bool OtaReady { get; set; }
}

public class PendantDeviceInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Port { get; set; } = "";
    public string Ip { get; set; } = "";
    public string Version { get; set; } = "";
    public bool Licensed { get; set; }
    public string DeviceId { get; set; } = "";
    public string DeviceModel { get; set; } = "";
}

public class PendantWifiInfo
{
    public string Ssid { get; set; } = "";
    public string Password { get; set; } = "";
    public string Ip { get; set; } = "";
    public int Port { get; set; }
}

public class PendantFirmwareInfo
{
    public bool UpdateAvailable { get; set; }
    public string CurrentVersion { get; set; } = "";
    public string LatestVersion { get; set; } = "";
    public string DownloadUrl { get; set; } = "";
}

public class PendantSerialConnectRequest
{
    public string Port { get; set; } = "";
}

public class PendantActivateWifiRequest
{
    public string InstallationId { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string PendantIp { get; set; } = "";
}

public class PendantActivateUsbRequest
{
    public string InstallationId { get; set; } = "";
}

public class PendantDeactivateWifiRequest
{
    public string PendantIp { get; set; } = "";
}
