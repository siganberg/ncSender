namespace NcSender.Core.Models;

/// <summary>
/// One ncSender accessory as the Accessories view sees it: what it is, how it
/// is reached, whether it is licensed, and what firmware it has against what is
/// available.
/// </summary>
public class AccessoryInfo
{
    /// <summary>Stable id, matching the factory catalogue ("wireless-usb", "pendant", …).</summary>
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    /// <summary>
    /// How the host reaches it: "usb" or "wireless". The Wireless USB is always
    /// "usb" — it is the thing that provides wireless, so it can never be on the
    /// far side of its own radio.
    /// </summary>
    public string Transport { get; set; } = "usb";

    public bool Connected { get; set; }

    /// <summary>Null when the device has not told us, rather than guessing false.</summary>
    public bool? Licensed { get; set; }

    public string DeviceId { get; set; } = "";

    /// <summary>Firmware on the device now, or "" if it has not reported one.</summary>
    public string CurrentVersion { get; set; } = "";

    /// <summary>Newest published release, or "" if the check has not run or failed.</summary>
    public string LatestVersion { get; set; } = "";

    public bool UpdateAvailable { get; set; }

    /// <summary>Asset to push when updating. Empty when there is nothing to offer.</summary>
    public string DownloadUrl { get; set; } = "";

    /// <summary>Why the release check could not answer, for the UI to show plainly.</summary>
    public string? UpdateCheckError { get; set; }
}
