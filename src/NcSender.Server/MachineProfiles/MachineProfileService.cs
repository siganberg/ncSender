using System.Text.Json.Nodes;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.MachineProfiles;

/// <summary>
/// Known machines for the Machine Setup wizard, from the
/// siganberg/ncSender.machine-profiles releases. The wizard asks each time it
/// opens: a copy fetched in the last day is used as is, otherwise the latest
/// release is downloaded. Without internet (or when GitHub refuses) the last
/// copy is used, and failing that the one built into this release.
/// </summary>
public sealed class MachineProfileService
{
    public const string ReleaseUrl = "https://github.com/siganberg/ncSender.machine-profiles/releases/latest/download/profiles.json";
    public const int SchemaVersion = 1;
    private static readonly TimeSpan MaxAge = TimeSpan.FromDays(1);

    private readonly Func<CancellationToken, Task<string>> _download;
    private readonly string _cachePath;
    private readonly Func<string?> _bundled;
    private readonly Func<DateTime> _now;
    private readonly ILogger<MachineProfileService> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public MachineProfileService(IHttpClientFactory http, ILogger<MachineProfileService> logger)
        : this(ct => DownloadAsync(http, ct), Path.Combine(PathUtils.GetUserDataDir(), "machine-profiles.json"),
               ReadBundled, () => DateTime.UtcNow, logger)
    {
    }

    internal MachineProfileService(Func<CancellationToken, Task<string>> download, string cachePath,
        Func<string?> bundled, Func<DateTime> now, ILogger<MachineProfileService> logger)
    {
        _download = download;
        _cachePath = cachePath;
        _bundled = bundled;
        _now = now;
        _logger = logger;
    }

    /// <summary>
    /// The profiles as {source, fetchedAt, schemaVersion, profiles}; source is
    /// "online", "cache" or "bundled". <paramref name="refresh"/> skips the
    /// one-day reuse and asks GitHub now.
    /// </summary>
    public async Task<JsonObject> GetAsync(bool refresh, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var cached = ReadCache();
            if (!refresh && cached is { } fresh && _now() - fresh.FetchedAt < MaxAge)
                return Result("cache", fresh.FetchedAt, fresh.Data);

            try
            {
                var json = await _download(ct);
                var data = Parse(json) ?? throw new InvalidDataException("not a machine profile list this version reads");
                Directory.CreateDirectory(Path.GetDirectoryName(_cachePath)!);
                await File.WriteAllTextAsync(_cachePath, json, ct);
                File.SetLastWriteTimeUtc(_cachePath, _now());
                return Result("online", _now(), data);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                _logger.LogInformation("Machine profiles not downloaded ({Error}); using the {Source} copy",
                    ex.Message, cached is null ? "built-in" : "saved");
            }

            if (cached is { } stale)
                return Result("cache", stale.FetchedAt, stale.Data);
            return Result("bundled", null, Parse(_bundled()) ?? new JsonObject { ["profiles"] = new JsonArray() });
        }
        finally
        {
            _gate.Release();
        }
    }

    private (JsonObject Data, DateTime FetchedAt)? ReadCache()
    {
        try
        {
            if (!File.Exists(_cachePath)) return null;
            var data = Parse(File.ReadAllText(_cachePath));
            return data is null ? null : (data, File.GetLastWriteTimeUtc(_cachePath));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Saved machine profiles unreadable");
            return null;
        }
    }

    // A list this version can read: schemaVersion it knows and a profiles array.
    internal static JsonObject? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            if (JsonNode.Parse(json) is not JsonObject obj) return null;
            if (obj["schemaVersion"]?.GetValueKind() != System.Text.Json.JsonValueKind.Number
                || obj["schemaVersion"]!.GetValue<int>() != SchemaVersion) return null;
            return obj["profiles"] is JsonArray ? obj : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static JsonObject Result(string source, DateTime? fetchedAt, JsonObject data) => new()
    {
        ["source"] = source,
        ["fetchedAt"] = fetchedAt?.ToString("o"),
        ["schemaVersion"] = SchemaVersion,
        ["profiles"] = data["profiles"]!.DeepClone(),
    };

    private static async Task<string> DownloadAsync(IHttpClientFactory factory, CancellationToken ct)
    {
        using var http = factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(8);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("ncSender");
        return await http.GetStringAsync(ReleaseUrl, ct);
    }

    // The copy CI downloaded from the latest release when this build was made.
    private static string? ReadBundled()
    {
        using var stream = typeof(MachineProfileService).Assembly.GetManifestResourceStream("NcSender.Server.MachineProfiles.machine-profiles.json");
        if (stream is null) return null;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
