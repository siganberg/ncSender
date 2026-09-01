using System.Text.Json;
using Microsoft.Extensions.Logging;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Accessories;

/// <summary>
/// One place that answers "what accessories are attached, what firmware is on
/// them, and is there anything newer" — for every accessory, whether it is
/// reached over the cable or relayed through the radio.
///
/// This exists to replace per-device firmware update built into each device's
/// plugin. Those each re-implemented release lookup, version comparison and
/// asset naming, so a fix to any of it had to be made several times.
/// </summary>
public sealed class AccessoryService
{
    private readonly IDongleDeviceService _dongle;
    private readonly IPendantManager _pendant;
    private readonly ILogger<AccessoryService> _logger;

    // Release lookups are cached: the view polls, GitHub rate-limits
    // unauthenticated callers hard, and a published release does not change
    // minute to minute.
    private static readonly TimeSpan ReleaseCacheTtl = TimeSpan.FromMinutes(15);
    private readonly Dictionary<string, (DateTime At, ReleaseInfo Info)> _releaseCache = new();
    private readonly SemaphoreSlim _releaseLock = new(1, 1);

    private sealed record ReleaseInfo(string Version, string DownloadUrl, string? Error);

    // A device's firmware version changes only when it reboots or is updated,
    // so asking on every list call is wasted time — and time is the problem
    // here: a device that does not implement $VERSION never answers, and the
    // query costs its full timeout on every single call. Cached per device and
    // cleared when it disconnects, so a reconnect re-asks.

    // Licence state for relayed peers, cached on the same terms as the version
    // above and for the same reason: it changes only on activation, removal or
    // a reboot, and every uncached miss costs a full radio timeout.

    // Short on purpose. This is a local cable or a one-hop radio link; a device
    // that is going to answer answers in tens of milliseconds. Anything longer
    // is a device that will not answer at all, and the view should not stall
    // for it.
    private const int VersionQueryTimeoutMs = 700;

    // A licence import crosses the radio and then writes NVS on the device, so
    // it is nothing like the quick status queries above and needs a real budget.
    private const int LicenceImportTimeoutMs = 6000;

    private readonly INcSenderUsbCatalog _usbCatalog;

    public AccessoryService(IDongleDeviceService dongle, IPendantManager pendant,
                            INcSenderUsbCatalog usbCatalog,
                            ILogger<AccessoryService> logger)
    {
        _dongle = dongle;
        _pendant = pendant;
        _usbCatalog = usbCatalog;
        _logger = logger;

        // Nothing is cached about a device, so nothing here has to be invalidated.
        // Version and licence are single round trips to hardware on the end of a
        // cable or a radio link the host already owns — measured at well under
        // 100ms for the whole list — and holding those answers only ever produced
        // a wrong one: a device that rebooted into new firmware inside the peer
        // timeout kept reporting its old version, and a query made before the
        // devices had reported in cached the silence and blanked every row. The
        // GitHub release lookup is the one genuinely remote call, and that is
        // cached on its own behind _releaseLock.

    }

    /// <summary>
    /// No-op, kept so callers that used to poke the cache still compile. Nothing
    /// is held any more: the next read asks the device.
    /// </summary>
    public void InvalidateLicence(string name) { }

    public async Task<List<AccessoryInfo>> ListAsync(bool checkUpdates, CancellationToken ct)
    {
        var peers = _dongle.GetDevices().ToDictionary(d => d.Name, StringComparer.OrdinalIgnoreCase);
        var dongleLicence = await SafeDongleLicenceAsync().ConfigureAwait(false);
        var pendantStatus = _pendant.GetStatus();

        // Built in parallel. Sequentially, every device that does not answer
        // costs its own timeout and they add up — five accessories could stall
        // the view for the sum of all of them. Concurrently the worst case is
        // one timeout total, and the release lookups overlap too.
        var tasks = AccessoryCatalog.All.Select(def => BuildAsync(
            def, peers, dongleLicence, pendantStatus, checkUpdates, ct));
        var built = await Task.WhenAll(tasks).ConfigureAwait(false);
        // Catalogue order, not completion order.
        return built.ToList();
    }

    private async Task<AccessoryInfo> BuildAsync(
        AccessoryDefinition def,
        Dictionary<string, DongleDeviceInfo> peers,
        DongleLicenseStatus? dongleLicence,
        PendantStatus pendantStatus,
        bool checkUpdates,
        CancellationToken ct)
    {
        {
            var info = new AccessoryInfo { Id = def.Id, Name = def.Name, Availability = def.Availability,
                                            PluginName = def.PluginName,
                                            AssetPrefix = def.AssetPrefix };

            if (def.Id == AccessoryCatalog.WirelessUsbId)
            {
                // Always the cable: it is the radio, so it is never behind one.
                info.Transport = "usb";
                info.Connected = dongleLicence?.Connected ?? false;
                info.Licensed = dongleLicence?.Licensed;
                info.DeviceId = dongleLicence?.DeviceId ?? "";
                if (info.Connected)
                    info.CurrentVersion = await _pendant.GetDongleVersionAsync().ConfigureAwait(false) ?? "";
            }
            else if (def.Id == "pendant")
            {
                // The pendant is relayed untagged, so the peer list is not the
                // authority on it — the pendant manager is.
                var dev = pendantStatus.UsbPendant ?? pendantStatus.WifiPendant;
                info.Connected = !string.Equals(pendantStatus.ConnectionState, "disconnected",
                                                StringComparison.OrdinalIgnoreCase);
                info.Transport = pendantStatus.ActiveConnectionType == "espnow" ? "wireless" : "usb";
                info.CurrentVersion = dev?.Version ?? "";
                info.Licensed = dev?.Licensed;
                info.DeviceId = dev?.DeviceId ?? "";
            }
            else if (def.PeerName is not null)
            {
                peers.TryGetValue(def.PeerName, out var peer);
                // "wireless" used to be hardcoded here, so an accessory sitting
                // on a cable still reported Wireless. The host does reach these
                // over the cable when one is present — that is the path a
                // firmware update takes — so report what is actually there.
                info.Transport = HasCable(def.PeerName) ? "usb" : "wireless";
                info.Connected = peer?.Connected ?? false;
                if (info.Connected)
                {
                    info.CurrentVersion = await PeerVersionAsync(def.PeerName, ct).ConfigureAwait(false);
                    // Without this the row reports no licence at all, which the
                    // view cannot tell apart from "licensed" — so an unlicensed
                    // accessory showed a dash and never offered activation.
                    var lic = await PeerLicenceAsync(def.PeerName, ct).ConfigureAwait(false);
                    info.Licensed = lic.Licensed;
                    info.DeviceId = lic.DeviceId;
                }
            }

            if (checkUpdates && info.Connected)
                await ApplyReleaseAsync(def, info, ct).ConfigureAwait(false);

            return info;
        }
    }

    /// <summary>Ask a relayed peer its version. Empty when it does not answer.</summary>
    // Is this accessory on a cable we can identify? Same VID/PID + product-string
    // lookup the updater uses to decide wired-vs-wireless, so the label and the
    // routing can never disagree.
    private bool HasCable(string peerName)
    {
        var kind = peerName.ToLowerInvariant() switch
        {
            "xprobe"       => NcSenderUsbKind.XProbe,
            "autodustboot" => NcSenderUsbKind.AutoDustBoot,
            "pendant"      => NcSenderUsbKind.Pendant,
            // RGB is a C3: no wired path today, so it is never on a cable as
            // far as this is concerned.
            _              => NcSenderUsbKind.Unknown,
        };
        if (kind == NcSenderUsbKind.Unknown) return false;
        try
        {
            foreach (var d in _usbCatalog.GetDevices())
                if (d.Kind == kind) return true;
        }
        catch { /* enumeration is best-effort; absence just means "no cable" */ }
        return false;
    }

    private async Task<string> PeerVersionAsync(string peerName, CancellationToken ct)
    {
        string version;
        try
        {
            var reply = await _dongle.QueryAsync(peerName, "$VERSION",
                l => l.StartsWith("$VERSION:", StringComparison.Ordinal),
                VersionQueryTimeoutMs).ConfigureAwait(false);
            version = reply is null ? "" : reply["$VERSION:".Length..].Trim();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No version from {Peer}", peerName);
            version = "";
        }

        return version;
    }

    /// <summary>
    /// Push a signed licence to an accessory. Fetching it is identical for
    /// every device; only this last hop differs, so it is the only part that
    /// branches on which accessory we are talking to.
    /// </summary>
    public async Task ImportLicenceAsync(AccessoryDefinition def, string licenceJson, CancellationToken ct)
    {
        var compact = LicenseClient.Compact(licenceJson);

        if (def.Id == AccessoryCatalog.WirelessUsbId)
        {
            await _pendant.ImportDongleLicenseAsync(compact).ConfigureAwait(false);
            return;
        }

        if (def.Id == "pendant")
        {
            await _pendant.ImportPendantLicenseAsync(licenceJson).ConfigureAwait(false);
            return;
        }

        if (def.PeerName is null)
            throw new InvalidOperationException($"{def.Name} cannot be activated");

        // The relayed peers all speak the same line protocol.
        var reply = await _dongle.QueryAsync(def.PeerName, $"$LICENSE:SET {compact}",
            l => l == "$LICENSE:OK" || l.StartsWith("$LICENSE:ERR", StringComparison.Ordinal),
            LicenceImportTimeoutMs).ConfigureAwait(false);

        if (reply is null)
            throw new InvalidOperationException($"{def.Name} did not answer the licence import");
        if (reply != "$LICENSE:OK")
            throw new InvalidOperationException(
                $"{def.Name} rejected the licence: {reply["$LICENSE:ERR".Length..].TrimStart(':', ' ')}");
    }

    /// <summary>
    /// Ask a relayed peer whether it is licensed, and for its device id.
    /// Null licence means it never answered — firmware without the licence
    /// commands, or a device that has gone quiet. That is deliberately distinct
    /// from false, which is a device that answered "unlicensed" and can be
    /// activated.
    /// </summary>
    private async Task<(bool? Licensed, string DeviceId)> PeerLicenceAsync(string peerName, CancellationToken ct)
    {
        bool? licensed = null;
        var deviceId = "";
        try
        {
            var status = await _dongle.QueryAsync(peerName, "$LICENSE:STATUS",
                l => l.StartsWith("$LICENSE:STATUS:", StringComparison.Ordinal),
                VersionQueryTimeoutMs).ConfigureAwait(false);
            if (status is not null)
            {
                var value = status["$LICENSE:STATUS:".Length..].Trim();
                licensed = value.Equals("LICENSED", StringComparison.OrdinalIgnoreCase);
            }

            // Only worth asking when the device is talking; the id is what the
            // activation call binds the licence to.
            if (licensed is not null)
            {
                var id = await _dongle.QueryAsync(peerName, "$LICENSE:ID",
                    l => l.StartsWith("$LICENSE:ID:", StringComparison.Ordinal),
                    VersionQueryTimeoutMs).ConfigureAwait(false);
                deviceId = id is null ? "" : id["$LICENSE:ID:".Length..].Trim();
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No licence state from {Peer}", peerName);
        }

        var result = (licensed, deviceId);
        return result;
    }

    private async Task ApplyReleaseAsync(AccessoryDefinition def, AccessoryInfo info, CancellationToken ct)
    {
        var release = await LatestReleaseAsync(def, ct).ConfigureAwait(false);
        if (release.Error is not null) { info.UpdateCheckError = release.Error; return; }

        info.LatestVersion = release.Version;
        info.DownloadUrl = release.DownloadUrl;
        // Only claim an update when both versions are actually known. A device
        // that has not reported its version must not be told it is out of date.
        info.UpdateAvailable = info.CurrentVersion.Length > 0
                            && release.Version.Length > 0
                            && IsNewer(release.Version, info.CurrentVersion);
    }

    private async Task<ReleaseInfo> LatestReleaseAsync(AccessoryDefinition def, CancellationToken ct)
    {
        await _releaseLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_releaseCache.TryGetValue(def.Id, out var hit) && DateTime.UtcNow - hit.At < ReleaseCacheTtl)
                return hit.Info;

            ReleaseInfo info;
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
                http.DefaultRequestHeaders.Add("User-Agent", "ncSender");
                var json = await http.GetStringAsync(
                    $"https://api.github.com/repos/{def.ReleaseRepo}/releases/latest", ct).ConfigureAwait(false);

                using var doc = JsonDocument.Parse(json);
                var version = (doc.RootElement.GetProperty("tag_name").GetString() ?? "").TrimStart('v');
                var url = "";
                if (doc.RootElement.TryGetProperty("assets", out var assets))
                {
                    var wanted = $"{def.AssetPrefix}{version}.bin";
                    foreach (var asset in assets.EnumerateArray())
                    {
                        if (!string.Equals(asset.GetProperty("name").GetString(), wanted,
                                           StringComparison.OrdinalIgnoreCase)) continue;
                        url = asset.GetProperty("browser_download_url").GetString() ?? "";
                        break;
                    }
                }
                info = new ReleaseInfo(version, url,
                    url.Length == 0 ? $"No asset named {def.AssetPrefix}{version}.bin in the latest release" : null);
            }
            catch (Exception ex)
            {
                // Offline is the normal case for a machine in a workshop, so
                // this is reported to the row rather than logged as a fault.
                info = new ReleaseInfo("", "", $"Could not reach {def.ReleaseRepo}");
                _logger.LogDebug(ex, "Release check failed for {Id}", def.Id);
            }

            _releaseCache[def.Id] = (DateTime.UtcNow, info);
            return info;
        }
        finally { _releaseLock.Release(); }
    }

    private async Task<DongleLicenseStatus?> SafeDongleLicenceAsync()
    {
        try { return await _pendant.GetDongleLicenseAsync().ConfigureAwait(false); }
        catch { return null; }   // no dongle attached is not an error here
    }

    /// <summary>Numeric-segment compare, ignoring any pre-release suffix.</summary>
    internal static bool IsNewer(string candidate, string current)
    {
        static int[] Parts(string v)
        {
            var core = v.TrimStart('v').Split('-', '+')[0];
            return core.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
        }
        var a = Parts(candidate);
        var b = Parts(current);
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            var x = i < a.Length ? a[i] : 0;
            var y = i < b.Length ? b[i] : 0;
            if (x != y) return x > y;
        }
        return false;
    }
}
