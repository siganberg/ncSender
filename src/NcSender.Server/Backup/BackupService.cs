using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Backup;

// Uses NcSenderJsonContext (source-generated) for BackupManifest instead of
// reflection-based JsonSerializer.SerializeAsync<T> — required for AOT.

public class BackupService : IBackupService
{
    private readonly ILogger<BackupService> _logger;
    private readonly string _edition;
    private readonly string _dataDir;

    public BackupService(ILogger<BackupService> logger, string edition)
        : this(logger, edition, PathUtils.GetUserDataDir()) { }

    // Testable constructor — pass a temp dir to avoid touching real user data.
    public BackupService(ILogger<BackupService> logger, string edition, string dataDir)
    {
        _logger = logger;
        _edition = edition;
        _dataDir = dataDir;
    }

    // === Bucket keys ===
    // Kept as string constants (not enum) so they survive JSON round-trips
    // and appear literally in the manifest for user inspection.
    private const string BUCKET_SETTINGS         = "settings";
    private const string BUCKET_TOOLS            = "tools";
    private const string BUCKET_MACROS           = "macros";
    private const string BUCKET_PLUGIN_REGISTRY  = "plugin-registry";
    private const string BUCKET_PLUGIN_CONFIG    = "plugin-config";
    private const string BUCKET_PLUGINS_CODE     = "plugins-code";
    private const string BUCKET_COMMAND_HISTORY  = "command-history";
    private const string BUCKET_GCODE_FILES      = "gcode-files";

    /// <summary>
    /// One entry per bucket. Path is either a single file or a directory,
    /// distinguished by IsDirectory. All paths are relative to
    /// PathUtils.GetUserDataDir() so imports can rebuild them on any host.
    /// </summary>
    private sealed record BucketSpec(string Key, string RelativePath, bool IsDirectory);

    private static readonly BucketSpec[] AllBuckets =
    {
        new(BUCKET_SETTINGS,        "settings.json",         false),
        new(BUCKET_TOOLS,           "tools.json",            false),
        new(BUCKET_MACROS,          "macros",                true),   // dir; macros.json handled separately below
        new(BUCKET_PLUGIN_REGISTRY, "plugins.json",          false),
        new(BUCKET_PLUGIN_CONFIG,   "plugin-config",         true),
        new(BUCKET_PLUGINS_CODE,    "plugins",               true),
        new(BUCKET_COMMAND_HISTORY, "command-history.json",  false),
        new(BUCKET_GCODE_FILES,     "gcode-files",           true),
    };

    // Special-case: macros.json sits at the root next to the macros/ dir, and
    // logically belongs to the macros bucket. We include it under the macros
    // bucket so both survive/replace together.
    private const string MACROS_INDEX_FILE = "macros.json";

    public string SuggestFilename() =>
        $"ncsender-backup-{Environment.MachineName}-{DateTime.UtcNow:yyyyMMdd-HHmmss}.ncsbackup";

    public async Task ExportAsync(BackupOptions options, Stream destination, CancellationToken cancellationToken = default)
    {
        var dataDir = _dataDir;
        var selectedBuckets = SelectBuckets(options);
        var manifest = new BackupManifest
        {
            SchemaVersion = 1,
            SourceAppVersion = GetAppVersion(),
            SourceEdition = _edition,
            CreatedAt = DateTime.UtcNow.ToString("O"),
            CreatedOnHost = Environment.MachineName,
            Buckets = selectedBuckets.Select(b => b.Key).ToList(),
        };

        // leaveOpen: true so the caller controls when the response stream closes.
        using var archive = new ZipArchive(destination, ZipArchiveMode.Create, leaveOpen: true);

        // manifest.json at the root
        var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
        await using (var manifestStream = manifestEntry.Open())
        {
            await JsonSerializer.SerializeAsync(
                manifestStream, manifest, NcSenderJsonContext.Default.BackupManifest, cancellationToken);
        }

        foreach (var bucket in selectedBuckets)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var fullPath = Path.Combine(dataDir, bucket.RelativePath);
            if (bucket.IsDirectory)
            {
                if (Directory.Exists(fullPath))
                    AddDirectoryToArchive(archive, fullPath, bucket.RelativePath, cancellationToken);
            }
            else
            {
                if (File.Exists(fullPath))
                    AddFileToArchive(archive, fullPath, bucket.RelativePath);
            }

            // Macros bucket also carries macros.json (sibling of macros/ dir)
            if (bucket.Key == BUCKET_MACROS)
            {
                var macrosIndex = Path.Combine(dataDir, MACROS_INDEX_FILE);
                if (File.Exists(macrosIndex))
                    AddFileToArchive(archive, macrosIndex, MACROS_INDEX_FILE);
            }
        }

        _logger.LogInformation("Backup exported with buckets: {Buckets}", string.Join(", ", manifest.Buckets));
    }

    public async Task<BackupImportResult> ImportAsync(Stream source, CancellationToken cancellationToken = default)
    {
        var dataDir = _dataDir;
        // Staging under the data dir so File.Move stays on the same volume.
        // Any leftover staging dir from a crashed prior import is cleared first.
        var stagingDir = Path.Combine(dataDir, ".backup-staging");
        if (Directory.Exists(stagingDir))
            Directory.Delete(stagingDir, recursive: true);
        Directory.CreateDirectory(stagingDir);

        try
        {
            using (var archive = new ZipArchive(source, ZipArchiveMode.Read, leaveOpen: true))
            {
                var manifestEntry = archive.GetEntry("manifest.json")
                    ?? throw new InvalidDataException("Backup is missing manifest.json — this doesn't look like an ncSender backup.");

                BackupManifest manifest;
                await using (var manifestStream = manifestEntry.Open())
                {
                    manifest = await JsonSerializer.DeserializeAsync(
                        manifestStream, NcSenderJsonContext.Default.BackupManifest, cancellationToken)
                        ?? throw new InvalidDataException("manifest.json is empty or malformed.");
                }

                if (manifest.SchemaVersion < 1 || manifest.SchemaVersion > 1)
                    throw new InvalidDataException($"Unsupported backup schema version: {manifest.SchemaVersion}. This build understands schema v1.");

                // Extract entries to staging, ignoring paths that would escape.
                foreach (var entry in archive.Entries)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (entry.FullName == "manifest.json") continue;
                    if (string.IsNullOrEmpty(entry.Name) && entry.FullName.EndsWith('/')) continue; // dir marker

                    var normalized = entry.FullName.Replace('\\', '/');
                    if (normalized.Contains("..") || Path.IsPathRooted(normalized))
                    {
                        _logger.LogWarning("Skipping suspicious entry {Entry}", entry.FullName);
                        continue;
                    }

                    var destPath = Path.Combine(stagingDir, normalized);
                    Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                    entry.ExtractToFile(destPath, overwrite: true);
                }

                // Now atomically swap each bucket. Wipe + replace per bucket.
                // Buckets NOT listed in the manifest are left untouched.
                var restored = new List<string>();
                foreach (var bucketKey in manifest.Buckets)
                {
                    var spec = AllBuckets.FirstOrDefault(b => b.Key == bucketKey);
                    if (spec is null)
                    {
                        _logger.LogWarning("Unknown bucket in manifest: {Bucket} — skipping", bucketKey);
                        continue;
                    }

                    var stagedPath = Path.Combine(stagingDir, spec.RelativePath);
                    var targetPath = Path.Combine(dataDir, spec.RelativePath);

                    // Only replace if the backup actually included content for this bucket.
                    var hasContent = spec.IsDirectory ? Directory.Exists(stagedPath) : File.Exists(stagedPath);
                    if (!hasContent)
                    {
                        _logger.LogWarning("Bucket {Bucket} listed in manifest but no content in archive", bucketKey);
                        continue;
                    }

                    SwapInPlace(targetPath, stagedPath, spec.IsDirectory);

                    if (bucketKey == BUCKET_MACROS)
                    {
                        var stagedIndex = Path.Combine(stagingDir, MACROS_INDEX_FILE);
                        var targetIndex = Path.Combine(dataDir, MACROS_INDEX_FILE);
                        if (File.Exists(stagedIndex))
                            SwapInPlace(targetIndex, stagedIndex, isDirectory: false);
                    }

                    restored.Add(bucketKey);
                }

                _logger.LogInformation("Backup imported. Restored buckets: {Buckets}", string.Join(", ", restored));

                return new BackupImportResult
                {
                    Success = true,
                    RestoredBuckets = restored,
                    RestartRequired = true,
                };
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Backup import failed");
            return new BackupImportResult
            {
                Success = false,
                Error = ex.Message,
                RestartRequired = false,
            };
        }
        finally
        {
            try { if (Directory.Exists(stagingDir)) Directory.Delete(stagingDir, recursive: true); }
            catch (Exception ex) { _logger.LogWarning(ex, "Failed to clean up staging dir {Dir}", stagingDir); }
        }
    }

    private static void SwapInPlace(string targetPath, string stagedPath, bool isDirectory)
    {
        if (isDirectory)
        {
            if (Directory.Exists(targetPath))
                Directory.Delete(targetPath, recursive: true);
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            Directory.Move(stagedPath, targetPath);
        }
        else
        {
            if (File.Exists(targetPath))
                File.Delete(targetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            File.Move(stagedPath, targetPath);
        }
    }

    private static IEnumerable<BucketSpec> SelectBuckets(BackupOptions options)
    {
        // Five always-on buckets.
        yield return AllBuckets.First(b => b.Key == BUCKET_SETTINGS);
        yield return AllBuckets.First(b => b.Key == BUCKET_TOOLS);
        yield return AllBuckets.First(b => b.Key == BUCKET_MACROS);
        yield return AllBuckets.First(b => b.Key == BUCKET_PLUGIN_REGISTRY);
        yield return AllBuckets.First(b => b.Key == BUCKET_PLUGIN_CONFIG);

        if (options.IncludePluginsCode)   yield return AllBuckets.First(b => b.Key == BUCKET_PLUGINS_CODE);
        if (options.IncludeCommandHistory) yield return AllBuckets.First(b => b.Key == BUCKET_COMMAND_HISTORY);
        if (options.IncludeGcodeFiles)    yield return AllBuckets.First(b => b.Key == BUCKET_GCODE_FILES);
    }

    private static void AddFileToArchive(ZipArchive archive, string sourcePath, string entryPath)
    {
        var entry = archive.CreateEntry(entryPath.Replace('\\', '/'), CompressionLevel.Optimal);
        using var entryStream = entry.Open();
        using var fileStream = File.OpenRead(sourcePath);
        fileStream.CopyTo(entryStream);
    }

    private static void AddDirectoryToArchive(ZipArchive archive, string sourceDir, string entryPrefix, CancellationToken ct)
    {
        foreach (var file in Directory.EnumerateFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            ct.ThrowIfCancellationRequested();
            var rel = Path.GetRelativePath(sourceDir, file).Replace('\\', '/');
            AddFileToArchive(archive, file, $"{entryPrefix}/{rel}");
        }
    }

    private static string GetAppVersion()
    {
        var asm = Assembly.GetEntryAssembly();
        var version = asm?.GetName().Version?.ToString();
        return version ?? "unknown";
    }

}
