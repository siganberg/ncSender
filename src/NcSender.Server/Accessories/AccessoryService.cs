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

    public AccessoryService(IDongleDeviceService dongle, IPendantManager pendant,
                            ILogger<AccessoryService> logger)
    {
        _dongle = dongle;
        _pendant = pendant;
        _logger = logger;
    }

    public async Task<List<AccessoryInfo>> ListAsync(bool checkUpdates, CancellationToken ct)
    {
        var peers = _dongle.GetDevices().ToDictionary(d => d.Name, StringComparer.OrdinalIgnoreCase);
        var dongleLicence = await SafeDongleLicenceAsync().ConfigureAwait(false);
        var pendantStatus = _pendant.GetStatus();

        var result = new List<AccessoryInfo>();
        foreach (var def in AccessoryCatalog.All)
        {
            var info = new AccessoryInfo { Id = def.Id, Name = def.Name };

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
                info.Transport = "wireless";
                info.Connected = peer?.Connected ?? false;
                if (info.Connected)
                    info.CurrentVersion = await PeerVersionAsync(def.PeerName, ct).ConfigureAwait(false);
            }

            if (checkUpdates && info.Connected)
                await ApplyReleaseAsync(def, info, ct).ConfigureAwait(false);

            result.Add(info);
        }
        return result;
    }

    /// <summary>Ask a relayed peer its version. Empty when it does not answer.</summary>
    private async Task<string> PeerVersionAsync(string peerName, CancellationToken ct)
    {
        try
        {
            var reply = await _dongle.QueryAsync(peerName, "$VERSION",
                l => l.StartsWith("$VERSION:", StringComparison.Ordinal), 2000).ConfigureAwait(false);
            return reply is null ? "" : reply["$VERSION:".Length..].Trim();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No version from {Peer}", peerName);
            return "";
        }
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
