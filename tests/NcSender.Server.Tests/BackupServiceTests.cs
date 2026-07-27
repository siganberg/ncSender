using System.IO.Compression;
using Microsoft.Extensions.Logging.Abstractions;
using NcSender.Core.Models;
using NcSender.Server.Backup;
using Xunit;

namespace NcSender.Server.Tests;

public class BackupServiceTests : IDisposable
{
    private readonly string _srcDir;
    private readonly string _dstDir;

    public BackupServiceTests()
    {
        _srcDir = Path.Combine(Path.GetTempPath(), $"ncsender-backup-src-{Guid.NewGuid():N}");
        _dstDir = Path.Combine(Path.GetTempPath(), $"ncsender-backup-dst-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_srcDir);
        Directory.CreateDirectory(_dstDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_srcDir)) Directory.Delete(_srcDir, true);
        if (Directory.Exists(_dstDir)) Directory.Delete(_dstDir, true);
    }

    private BackupService MakeService(string dir) => new(NullLogger<BackupService>.Instance, "community", dir);

    private void SeedTypicalData(string dir)
    {
        File.WriteAllText(Path.Combine(dir, "settings.json"), "{\"foo\":1}");
        File.WriteAllText(Path.Combine(dir, "tools.json"),    "[{\"toolNumber\":1}]");
        File.WriteAllText(Path.Combine(dir, "plugins.json"),  "[{\"id\":\"acme\"}]");
        File.WriteAllText(Path.Combine(dir, "macros.json"),   "[{\"id\":\"m1\"}]");
        File.WriteAllText(Path.Combine(dir, "command-history.json"), "[]");

        Directory.CreateDirectory(Path.Combine(dir, "macros"));
        File.WriteAllText(Path.Combine(dir, "macros", "m1.gcode"), "G0 X10");

        Directory.CreateDirectory(Path.Combine(dir, "plugin-config", "com.acme"));
        File.WriteAllText(Path.Combine(dir, "plugin-config", "com.acme", "config.json"), "{\"enabled\":true}");

        Directory.CreateDirectory(Path.Combine(dir, "plugins", "com.acme"));
        File.WriteAllText(Path.Combine(dir, "plugins", "com.acme", "index.js"), "export {}");

        Directory.CreateDirectory(Path.Combine(dir, "gcode-files"));
        File.WriteAllText(Path.Combine(dir, "gcode-files", "part.nc"), "G0 X0 Y0\n");
    }

    [Fact]
    public async Task Export_ProducesZipWithManifestAndAlwaysOnBuckets()
    {
        SeedTypicalData(_srcDir);
        var svc = MakeService(_srcDir);

        using var mem = new MemoryStream();
        await svc.ExportAsync(new BackupOptions(), mem);
        mem.Position = 0;

        using var archive = new ZipArchive(mem, ZipArchiveMode.Read);
        Assert.NotNull(archive.GetEntry("manifest.json"));
        Assert.NotNull(archive.GetEntry("settings.json"));
        Assert.NotNull(archive.GetEntry("tools.json"));
        Assert.NotNull(archive.GetEntry("plugins.json"));
        Assert.NotNull(archive.GetEntry("macros.json"));
        Assert.NotNull(archive.GetEntry("macros/m1.gcode"));
        Assert.NotNull(archive.GetEntry("plugin-config/com.acme/config.json"));

        // Opt-in buckets NOT selected → not in archive.
        Assert.Null(archive.GetEntry("plugins/com.acme/index.js"));
        Assert.Null(archive.GetEntry("command-history.json"));
        Assert.Null(archive.GetEntry("gcode-files/part.nc"));
    }

    [Fact]
    public async Task Export_IncludesOptInBucketsWhenRequested()
    {
        SeedTypicalData(_srcDir);
        var svc = MakeService(_srcDir);

        using var mem = new MemoryStream();
        await svc.ExportAsync(new BackupOptions
        {
            IncludePluginsCode = true,
            IncludeCommandHistory = true,
            IncludeGcodeFiles = true,
        }, mem);
        mem.Position = 0;

        using var archive = new ZipArchive(mem, ZipArchiveMode.Read);
        Assert.NotNull(archive.GetEntry("plugins/com.acme/index.js"));
        Assert.NotNull(archive.GetEntry("command-history.json"));
        Assert.NotNull(archive.GetEntry("gcode-files/part.nc"));
    }

    [Fact]
    public async Task Export_SkipsBucketsThatDontExistOnDisk()
    {
        // Empty source dir — only settings.json exists.
        File.WriteAllText(Path.Combine(_srcDir, "settings.json"), "{}");
        var svc = MakeService(_srcDir);

        using var mem = new MemoryStream();
        await svc.ExportAsync(new BackupOptions(), mem);
        mem.Position = 0;

        using var archive = new ZipArchive(mem, ZipArchiveMode.Read);
        Assert.NotNull(archive.GetEntry("settings.json"));
        Assert.Null(archive.GetEntry("tools.json"));
        Assert.Null(archive.GetEntry("macros.json"));
        Assert.Null(archive.GetEntry("plugins.json"));
    }

    [Fact]
    public async Task RoundTrip_RestoresIdenticalContent()
    {
        SeedTypicalData(_srcDir);
        var srcSvc = MakeService(_srcDir);
        var dstSvc = MakeService(_dstDir);

        // Seed destination with different, pre-existing content that should be wiped.
        File.WriteAllText(Path.Combine(_dstDir, "settings.json"), "{\"old\":true}");
        Directory.CreateDirectory(Path.Combine(_dstDir, "macros"));
        File.WriteAllText(Path.Combine(_dstDir, "macros", "old.gcode"), "OLD");

        using var mem = new MemoryStream();
        await srcSvc.ExportAsync(new BackupOptions(), mem);
        mem.Position = 0;

        var result = await dstSvc.ImportAsync(mem);
        Assert.True(result.Success, result.Error);
        Assert.True(result.RestartRequired);
        Assert.Contains("settings", result.RestoredBuckets);
        Assert.Contains("macros", result.RestoredBuckets);

        // New content is in place.
        Assert.Equal("{\"foo\":1}",    File.ReadAllText(Path.Combine(_dstDir, "settings.json")));
        Assert.Equal("G0 X10",         File.ReadAllText(Path.Combine(_dstDir, "macros", "m1.gcode")));

        // Pre-existing macros/old.gcode wiped (bucket = wipe + replace).
        Assert.False(File.Exists(Path.Combine(_dstDir, "macros", "old.gcode")));
    }

    [Fact]
    public async Task Import_LeavesUnlistedBucketsUntouched()
    {
        // Backup that contains ONLY settings.
        File.WriteAllText(Path.Combine(_srcDir, "settings.json"), "{\"x\":1}");
        var srcSvc = MakeService(_srcDir);

        // Destination has pre-existing tools.json that should NOT be wiped
        // because the backup didn't mention the tools bucket.
        File.WriteAllText(Path.Combine(_dstDir, "tools.json"), "[{\"tool\":\"keep-me\"}]");
        var dstSvc = MakeService(_dstDir);

        using var mem = new MemoryStream();
        await srcSvc.ExportAsync(new BackupOptions(), mem);
        mem.Position = 0;

        var result = await dstSvc.ImportAsync(mem);
        Assert.True(result.Success);
        Assert.Contains("settings", result.RestoredBuckets);
        Assert.DoesNotContain("tools", result.RestoredBuckets);

        // Pre-existing tools.json survived — bucket wasn't in backup.
        Assert.Equal("[{\"tool\":\"keep-me\"}]", File.ReadAllText(Path.Combine(_dstDir, "tools.json")));
    }

    [Fact]
    public async Task Import_MissingManifest_ReturnsError()
    {
        var svc = MakeService(_dstDir);
        using var mem = new MemoryStream();
        using (var archive = new ZipArchive(mem, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("settings.json");
            using var s = entry.Open();
            s.Write(new byte[] { (byte)'{', (byte)'}' });
        }
        mem.Position = 0;

        var result = await svc.ImportAsync(mem);
        Assert.False(result.Success);
        Assert.Contains("manifest", result.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Import_ZipSlipAttempt_IsIgnored()
    {
        var svc = MakeService(_dstDir);
        using var mem = new MemoryStream();
        using (var archive = new ZipArchive(mem, ZipArchiveMode.Create, leaveOpen: true))
        {
            // Manifest that only mentions settings.
            var manifest = archive.CreateEntry("manifest.json");
            using (var s = manifest.Open())
            {
                var m = System.Text.Encoding.UTF8.GetBytes(
                    "{\"schemaVersion\":1,\"sourceAppVersion\":\"t\",\"sourceEdition\":\"community\",\"createdAt\":\"2026-01-01T00:00:00Z\",\"createdOnHost\":\"t\",\"buckets\":[\"settings\"]}");
                s.Write(m, 0, m.Length);
            }

            // Zip-slip entry that would try to escape the data dir.
            var evil = archive.CreateEntry("../../evil.txt");
            using var es = evil.Open();
            es.Write(new byte[] { 1 });
        }
        mem.Position = 0;

        var result = await svc.ImportAsync(mem);
        // Import completes; suspicious entry is silently skipped.
        Assert.True(result.Success);
        // Nothing was written outside _dstDir.
        var parentDir = Directory.GetParent(_dstDir)!.FullName;
        Assert.False(File.Exists(Path.Combine(parentDir, "..", "evil.txt")));
        Assert.False(File.Exists(Path.Combine(parentDir, "evil.txt")));
    }
}
