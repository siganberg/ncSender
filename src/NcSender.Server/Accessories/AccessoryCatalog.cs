namespace NcSender.Server.Accessories;

/// <summary>
/// One accessory ncSender can show, update and activate.
///
/// Mirrors the factory bench catalogue (ncSender.factory src/config/products.js)
/// deliberately: same ids, same release repos, same asset naming. Two places
/// have to agree about what a "wireless-usb" is, and keeping the vocabulary
/// identical is what stops them drifting apart.
/// </summary>
/// <param name="ReleaseRepo">Public GitHub repo publishing this device's releases.</param>
/// <param name="AssetPrefix">
/// Prefix of the APP-ONLY asset, completed with the version and ".bin".
/// App-only matters: a device writes an update into its inactive OTA slot, and
/// Update.h rejects an image carrying a bootloader and partition table.
/// </param>
/// <param name="PeerName">Radio peer name, or null for a device reached over USB.</param>
/// <param name="Availability">
/// Short label for hardware that is not on sale yet ("Coming Soon", "Not
/// available"), or null once it ships. The row still works for anyone holding
/// one — it is labelled, not hidden — but it must not read as something a
/// customer could go and buy today.
/// </param>
public sealed record AccessoryDefinition(
    string Id,
    string Name,
    string ReleaseRepo,
    string AssetPrefix,
    string? PeerName,
    string? Availability = null,
    /// <summary>
    /// Companion plugin that carries this device's settings, if it has one.
    /// This view owns firmware and activation; anything the device can be
    /// configured to DO lives in its plugin, and saying so beats leaving the
    /// reader to wonder where those controls went.
    /// </summary>
    string? PluginName = null,
    /// <summary>
    /// Product name the activation server knows this device by. Must match
    /// LICENSE_PRODUCT in the firmware exactly, case and punctuation included —
    /// the signed licence is bound to it, and a mismatch is rejected by the
    /// device rather than by the store. Null means the device cannot be
    /// activated from here.
    /// </summary>
    string? LicenseProduct = null);

public static class AccessoryCatalog
{
    /// <summary>The Wireless USB, addressed as itself rather than as a peer.</summary>
    public const string WirelessUsbId = "wireless-usb";

    public static readonly IReadOnlyList<AccessoryDefinition> All = new[]
    {
        // Always reached over USB: it is the radio, so it can never be on the
        // far side of one.
        new AccessoryDefinition(WirelessUsbId, "Wireless USB",
            "siganberg/ncsender.wireless-dongle.releases", "firmware_wireless_dongle_v", null,
            LicenseProduct: "ncsender-wireless-usb"),

        // The pendant's asset name depends on which board it is (pibot vs
        // ncsender), so its version and download are resolved by the pendant
        // manager, which knows the model, rather than by this prefix.
        new AccessoryDefinition("pendant", "Pendant",
            "siganberg/ncSender.pendant.releases", "firmware_ncsender_pendant_v", "pendant",
            LicenseProduct: "ncSenderPendant"),

        new AccessoryDefinition("autodustboot", "AutoDustBoot",
            "siganberg/ncSender.autodustboot.releases", "firmware_autodustboot_v", "autodustboot",
            Availability: "Coming Soon", PluginName: "AutoDustboot",
            LicenseProduct: "AutoDustBoot"),

        new AccessoryDefinition("rgbled", "RGB LED",
            "siganberg/ncSender.rgb.releases", "firmware_rgb_v", "rgbled",
            Availability: "Coming Soon", PluginName: "RGB LED",
            LicenseProduct: "ncsender.rgb"),

        // Prototype, not a product yet.
        new AccessoryDefinition("xprobe", "xProbe",
            "siganberg/ncSender.xprobe.releases", "firmware_xprobe_v", "xprobe",
            Availability: "Not available", LicenseProduct: "ncsender.xprobe"),
    };

    /// <summary>
    /// Marker every ncSender firmware image carries, identifying what it is.
    /// Checked before a hand-picked file is flashed: these accessories share a
    /// processor, so a mismatched image passes the device's own header check
    /// and boots as the wrong product. Filenames can be renamed; this cannot.
    /// </summary>
    public static string FirmwareIdMarker(string accessoryId) => $"NCSENDER-FW-ID:{accessoryId}:";

    /// <summary>
    /// What this image claims to be, or null if it carries no marker at all
    /// (firmware built before markers existed — allowed, but unverified).
    /// </summary>
    public static string? IdentifyImage(byte[] image)
    {
        foreach (var def in All)
        {
            var marker = System.Text.Encoding.ASCII.GetBytes(FirmwareIdMarker(def.Id));
            if (IndexOf(image, marker) >= 0) return def.Id;
        }
        return null;
    }

    private static int IndexOf(byte[] haystack, byte[] needle)
    {
        for (var i = 0; i + needle.Length <= haystack.Length; i++)
        {
            var hit = true;
            for (var j = 0; j < needle.Length; j++)
                if (haystack[i + j] != needle[j]) { hit = false; break; }
            if (hit) return i;
        }
        return -1;
    }

    public static AccessoryDefinition? ById(string id)
        => All.FirstOrDefault(a => string.Equals(a.Id, id, StringComparison.OrdinalIgnoreCase));
}
