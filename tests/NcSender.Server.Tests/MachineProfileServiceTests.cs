using Microsoft.Extensions.Logging.Abstractions;
using NcSender.Server.MachineProfiles;

namespace NcSender.Server.Tests;

/// <summary>
/// The wizard's machine list: a copy from the last day is reused, an older
/// one is replaced from GitHub, and without GitHub the saved copy and then
/// the built-in one stand in.
/// </summary>
public class MachineProfileServiceTests : IDisposable
{
    private const string Online = """{"schemaVersion":1,"profiles":[{"id":"online"}]}""";
    private const string Saved = """{"schemaVersion":1,"profiles":[{"id":"saved"}]}""";
    private const string Bundled = """{"schemaVersion":1,"profiles":[{"id":"bundled"}]}""";

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "ncs-profiles-" + Guid.NewGuid().ToString("N"));
    private string CachePath => Path.Combine(_dir, "machine-profiles.json");
    private DateTime _now = new(2026, 10, 20, 12, 0, 0, DateTimeKind.Utc);
    private int _downloads;
    private Func<string> _reply = () => Online;

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }

    private MachineProfileService Service() => new(
        _ => { _downloads++; return Task.FromResult(_reply()); },
        CachePath, () => Bundled, () => _now, NullLogger<MachineProfileService>.Instance);

    private void SaveCache(string json, TimeSpan age)
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(CachePath, json);
        File.SetLastWriteTimeUtc(CachePath, _now - age);
    }

    private static string FirstId(System.Text.Json.Nodes.JsonObject result) => result["profiles"]![0]!["id"]!.GetValue<string>();

    [Fact]
    public async Task NoCopy_DownloadsAndSaves()
    {
        var result = await Service().GetAsync(refresh: false);
        Assert.Equal("online", result["source"]!.GetValue<string>());
        Assert.Equal("online", FirstId(result));
        Assert.Equal(Online, File.ReadAllText(CachePath));
    }

    [Fact]
    public async Task CopyFromToday_IsUsedWithoutAsking()
    {
        SaveCache(Saved, TimeSpan.FromHours(3));
        var result = await Service().GetAsync(refresh: false);
        Assert.Equal(0, _downloads);
        Assert.Equal("cache", result["source"]!.GetValue<string>());
        Assert.Equal("saved", FirstId(result));
    }

    [Fact]
    public async Task CopyOlderThanADay_IsReplaced()
    {
        SaveCache(Saved, TimeSpan.FromHours(25));
        var result = await Service().GetAsync(refresh: false);
        Assert.Equal(1, _downloads);
        Assert.Equal("online", FirstId(result));
    }

    [Fact]
    public async Task Refresh_AsksEvenWithAFreshCopy()
    {
        SaveCache(Saved, TimeSpan.FromMinutes(5));
        var result = await Service().GetAsync(refresh: true);
        Assert.Equal(1, _downloads);
        Assert.Equal("online", FirstId(result));
    }

    [Fact]
    public async Task DownloadFails_UsesTheSavedCopyHoweverOld()
    {
        SaveCache(Saved, TimeSpan.FromDays(30));
        _reply = () => throw new HttpRequestException("rate limited");
        var result = await Service().GetAsync(refresh: true);
        Assert.Equal("cache", result["source"]!.GetValue<string>());
        Assert.Equal("saved", FirstId(result));
    }

    [Fact]
    public async Task DownloadFails_NoCopy_UsesTheBuiltInOne()
    {
        _reply = () => throw new TaskCanceledException("timeout");
        var result = await Service().GetAsync(refresh: false);
        Assert.Equal("bundled", result["source"]!.GetValue<string>());
        Assert.Equal("bundled", FirstId(result));
        Assert.False(File.Exists(CachePath));
    }

    [Theory]
    [InlineData("""{"schemaVersion":2,"profiles":[]}""")]
    [InlineData("""{"profiles":[]}""")]
    [InlineData("<html>rate limit</html>")]
    public async Task UnreadableDownload_IsNotSaved(string reply)
    {
        SaveCache(Saved, TimeSpan.FromDays(2));
        _reply = () => reply;
        var result = await Service().GetAsync(refresh: false);
        Assert.Equal("saved", FirstId(result));
        Assert.Equal(Saved, File.ReadAllText(CachePath));
    }

    [Fact]
    public void BuiltInCopy_IsInTheBuild()
    {
        var bundled = typeof(MachineProfileService).Assembly
            .GetManifestResourceStream("NcSender.Server.MachineProfiles.machine-profiles.json");
        Assert.NotNull(bundled);
        using var reader = new StreamReader(bundled);
        Assert.NotNull(MachineProfileService.Parse(reader.ReadToEnd()));
    }
}
