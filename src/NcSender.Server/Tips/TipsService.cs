using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Tips;

/// <summary>
/// Tips &amp; Tricks content. A handful of tips ship built in (ids 1-99); the
/// rest come from tips.json in the public siganberg/ncSender.tips repo so
/// new ones can be added without an app release. The remote index and its
/// media are cached under the user data dir, so once seen a tip keeps
/// working offline.
/// </summary>
public class TipsService : ITipsService
{
    private const string IndexUrl = "https://raw.githubusercontent.com/siganberg/ncSender.tips/main/tips.json";
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(10);

    private readonly ILogger<TipsService> _logger;
    private readonly string _edition;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private TipsIndex? _remote;
    private DateTime? _fetchedAt;
    private DateTime _lastAttempt = DateTime.MinValue;
    private bool _online;
    private bool _cacheLoaded;

    public TipsService(ILogger<TipsService> logger, string edition)
    {
        _logger = logger;
        _edition = edition;
    }

    private static string IndexCachePath => Path.Combine(PathUtils.GetTipsCacheDir(), "tips.json");

    public async Task<TipsResponse> GetTipsAsync(bool refresh, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!_cacheLoaded) LoadCache();
            if (refresh && DateTime.UtcNow - _lastAttempt > RefreshInterval)
                await FetchRemoteAsync(ct);
        }
        finally
        {
            _lock.Release();
        }

        var current = BuildVersion.Value;
        // Dev builds report 0.0.0-dev; treat them as newest so remote tips
        // with a minVersion still show up while developing.
        var isDev = current.StartsWith("0.0.0", StringComparison.Ordinal);
        var merged = new Dictionary<int, TipItem>();
        foreach (var t in BuiltInTips.Items) merged[t.Id] = t;
        if (_remote is not null)
            foreach (var t in _remote.Tips) merged[t.Id] = t;

        var tips = merged.Values
            .Where(t => isDev || t.MinVersion is null || CompareVersions(current, t.MinVersion) >= 0)
            .OrderBy(t => t.Id)
            .Select(t => new TipItem
            {
                Id = t.Id,
                Title = t.Title,
                Body = t.Body,
                Edition = string.IsNullOrWhiteSpace(t.Edition) ? "all" : t.Edition.ToLowerInvariant(),
                MinVersion = t.MinVersion,
                // The client never talks to GitHub: media goes through the
                // local cache route, poster included.
                Media = t.Media is null || string.IsNullOrWhiteSpace(t.Media.Src) ? null : new TipMedia
                {
                    Type = t.Media.Type,
                    Src = $"/api/tips/media/{t.Id}",
                    Poster = string.IsNullOrWhiteSpace(t.Media.Poster) ? null : $"/api/tips/media/{t.Id}/poster"
                }
            })
            .ToList();

        return new TipsResponse
        {
            Edition = _edition,
            Version = current,
            Online = _online,
            FetchedAt = _fetchedAt?.ToString("o"),
            Tips = tips
        };
    }

    public async Task<string?> GetMediaPathAsync(int tipId, bool poster, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try { if (!_cacheLoaded) LoadCache(); }
        finally { _lock.Release(); }

        var tip = _remote?.Tips.FirstOrDefault(t => t.Id == tipId)
                  ?? BuiltInTips.Items.FirstOrDefault(t => t.Id == tipId);
        var rel = poster ? tip?.Media?.Poster : tip?.Media?.Src;
        if (tip is null || string.IsNullOrWhiteSpace(rel)) return null;

        var url = rel.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                  || rel.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? rel
            : (_remote?.BaseUrl ?? "").TrimEnd('/') + "/" + rel.TrimStart('/');

        var ext = Path.GetExtension(new Uri(url).AbsolutePath);
        if (string.IsNullOrEmpty(ext)) ext = poster ? ".jpg" : ".mp4";
        var dir = PathUtils.GetTipsMediaDir();
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"{tipId}{(poster ? "-poster" : "")}{ext}");
        if (File.Exists(path)) return path;

        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
            http.DefaultRequestHeaders.Add("User-Agent", "ncSender");
            using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            resp.EnsureSuccessStatusCode();
            var tmp = path + ".part";
            await using (var src = await resp.Content.ReadAsStreamAsync(ct))
            await using (var dst = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous))
                await src.CopyToAsync(dst, ct);
            File.Move(tmp, path, overwrite: true);
            _logger.LogInformation("Cached tip media {Path}", path);
            return path;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Tip media download failed for tip {Id}", tipId);
            return null;
        }
    }

    private void LoadCache()
    {
        _cacheLoaded = true;
        try
        {
            if (!File.Exists(IndexCachePath)) return;
            var json = File.ReadAllText(IndexCachePath);
            _remote = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.TipsIndex);
            _fetchedAt = File.GetLastWriteTimeUtc(IndexCachePath);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load cached tips index");
        }
    }

    private async Task FetchRemoteAsync(CancellationToken ct)
    {
        _lastAttempt = DateTime.UtcNow;
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            http.DefaultRequestHeaders.Add("User-Agent", "ncSender");
            var json = await http.GetStringAsync(IndexUrl, ct);
            var index = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.TipsIndex);
            if (index is null || index.Tips.Count == 0)
                throw new InvalidOperationException("Empty tips index");

            _remote = index;
            _fetchedAt = DateTime.UtcNow;
            _online = true;
            Directory.CreateDirectory(PathUtils.GetTipsCacheDir());
            await File.WriteAllTextAsync(IndexCachePath, json, ct);
            _logger.LogInformation("Fetched {Count} tips from {Url}", index.Tips.Count, IndexUrl);
        }
        catch (Exception ex)
        {
            _online = false;
            _logger.LogDebug(ex, "Tips index fetch failed; serving cache");
        }
    }

    /// <summary>Semver-ish compare ("2.0.197", "2.0.198-beta.1"); pre-release sorts below its release.</summary>
    internal static int CompareVersions(string a, string b)
    {
        static (int[] parts, string pre) Parse(string v)
        {
            v = v.Trim().TrimStart('v');
            var dash = v.IndexOf('-');
            var core = dash >= 0 ? v[..dash] : v;
            var pre = dash >= 0 ? v[(dash + 1)..] : "";
            var parts = core.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
            return (parts, pre);
        }
        var (pa, prea) = Parse(a);
        var (pb, preb) = Parse(b);
        for (var i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            var x = i < pa.Length ? pa[i] : 0;
            var y = i < pb.Length ? pb[i] : 0;
            if (x != y) return x.CompareTo(y);
        }
        if (prea.Length == 0 && preb.Length == 0) return 0;
        if (prea.Length == 0) return 1;
        if (preb.Length == 0) return -1;
        return string.CompareOrdinal(prea, preb);
    }
}
