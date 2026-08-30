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
public sealed record AccessoryDefinition(
    string Id,
    string Name,
    string ReleaseRepo,
    string AssetPrefix,
    string? PeerName);

public static class AccessoryCatalog
{
    /// <summary>The Wireless USB, addressed as itself rather than as a peer.</summary>
    public const string WirelessUsbId = "wireless-usb";

    public static readonly IReadOnlyList<AccessoryDefinition> All = new[]
    {
        // Always reached over USB: it is the radio, so it can never be on the
        // far side of one.
        new AccessoryDefinition(WirelessUsbId, "Wireless USB",
            "siganberg/ncsender.wireless-dongle.releases", "firmware_wireless_dongle_v", null),

        // The pendant's asset name depends on which board it is (pibot vs
        // ncsender), so its version and download are resolved by the pendant
        // manager, which knows the model, rather than by this prefix.
        new AccessoryDefinition("pendant", "Pendant",
            "siganberg/ncSender.pendant.releases", "firmware_ncsender_pendant_v", "pendant"),

        new AccessoryDefinition("autodustboot", "AutoDustBoot",
            "siganberg/ncSender.autodustboot.releases", "firmware_autodustboot_v", "autodustboot"),

        new AccessoryDefinition("rgbled", "RGB LED",
            "siganberg/ncSender.rgb.releases", "firmware_rgb_v", "rgbled"),

        new AccessoryDefinition("xprobe", "xProbe",
            "siganberg/ncSender.xprobe.releases", "firmware_xprobe_v", "xprobe"),
    };

    public static AccessoryDefinition? ById(string id)
        => All.FirstOrDefault(a => string.Equals(a.Id, id, StringComparison.OrdinalIgnoreCase));
}
