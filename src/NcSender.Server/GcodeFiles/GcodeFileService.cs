using System.Globalization;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Core.Utils;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.GcodeFiles;

public class GcodeFileService : IGcodeFileService
{
    private readonly IServerContext _context;
    private readonly IBroadcaster _broadcaster;
    private readonly ILogger<GcodeFileService> _logger;
    private readonly IFirmwareService _firmwareService;
    private readonly ISettingsManager _settingsManager;
    private readonly IPluginManager? _pluginManager;

    private string StorageDir => PathUtils.GetGcodeFilesDir();
    private string CacheDir => PathUtils.GetGcodeCacheDir();
    private string CurrentCachePath => Path.Combine(CacheDir, "current.gcode");

    public GcodeFileService(
        IServerContext context,
        IBroadcaster broadcaster,
        ILogger<GcodeFileService> logger,
        IFirmwareService firmwareService,
        ISettingsManager settingsManager,
        IPluginManager? pluginManager = null)
    {
        _context = context;
        _broadcaster = broadcaster;
        _logger = logger;
        _firmwareService = firmwareService;
        _settingsManager = settingsManager;
        _pluginManager = pluginManager;
    }

    private string ApplyPluginTransforms(string content, string filename, string? sourcePath)
    {
        if (_pluginManager is null) return content;
        var ctx = new Dictionary<string, object?>
        {
            ["filename"] = filename,
            ["sourcePath"] = sourcePath,
        };
        return _pluginManager.ApplyOnGcodeProgramLoad(content, ctx);
    }

    public Task<GcodeFileTree> ListFilesAsync()
    {
        var tree = new GcodeFileTree
        {
            StoragePath = StorageDir,
            Tree = BuildTree(StorageDir, "")
        };
        return Task.FromResult(tree);
    }

    public async Task UploadFileAsync(string filename, Stream content)
    {
        if (!SafePath.IsValidName(filename))
            throw new ArgumentException($"Invalid filename: {filename}");

        var targetPath = SafePath.GetSafePath(StorageDir, filename)
            ?? throw new ArgumentException($"Invalid path: {filename}");

        Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
        await using var fs = File.Create(targetPath);
        await content.CopyToAsync(fs);

        _logger.LogInformation("Uploaded file: {Filename}", filename);
    }

    public async Task LoadFileAsync(string path, bool applyPluginTransforms = true)
    {
        var fullPath = SafePath.GetSafePath(StorageDir, path)
            ?? throw new ArgumentException($"Invalid path: {path}");

        if (!File.Exists(fullPath))
            throw new FileNotFoundException($"File not found: {path}");

        var filename = Path.GetFileName(path);
        var rawContent = await File.ReadAllTextAsync(fullPath);
        var content = applyPluginTransforms ? ApplyPluginTransforms(rawContent, filename, path) : rawContent;

        Directory.CreateDirectory(CacheDir);
        await File.WriteAllTextAsync(CurrentCachePath, content);

        var totalLines = content.Split('\n').Length;
        var estimatedSec = await CalculateEstimateAsync(content);

        UpdateJobLoaded(filename, totalLines, isTemporary: false, sourcePath: path, estimatedSec: estimatedSec);
        await _settingsManager.SaveSettings(new System.Text.Json.Nodes.JsonObject { ["lastLoadedFile"] = path });
        _logger.LogInformation("Loaded file: {Path} ({Lines} lines, est {Est}s)", path, totalLines, estimatedSec);
    }

    public async Task LoadTempContentAsync(string content, string filename, string? sourceFile = null)
    {
        var transformed = ApplyPluginTransforms(content, filename, sourceFile);

        Directory.CreateDirectory(CacheDir);
        await File.WriteAllTextAsync(CurrentCachePath, transformed);

        var totalLines = transformed.Split('\n').Length;
        var estimatedSec = await CalculateEstimateAsync(transformed);

        UpdateJobLoaded(filename, totalLines, isTemporary: true, sourcePath: sourceFile, estimatedSec: estimatedSec);
        _logger.LogInformation("Loaded temp content as: {Filename} ({Lines} lines, est {Est}s)", filename, totalLines, estimatedSec);
    }

    public Task<Stream?> GetCurrentDownloadStreamAsync()
    {
        if (!File.Exists(CurrentCachePath))
            return Task.FromResult<Stream?>(null);

        Stream stream = File.OpenRead(CurrentCachePath);
        return Task.FromResult<Stream?>(stream);
    }

    public Task<string?> GetFileAsync(string path)
    {
        var fullPath = SafePath.GetSafePath(StorageDir, path);
        if (fullPath is null || !File.Exists(fullPath))
            return Task.FromResult<string?>(null);

        return File.ReadAllTextAsync(fullPath)!;
    }

    public async Task SaveFileAsync(string path, string content)
    {
        var fullPath = SafePath.GetSafePath(StorageDir, path)
            ?? throw new ArgumentException($"Invalid path: {path}");

        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await File.WriteAllTextAsync(fullPath, content);

        _logger.LogInformation("Saved file: {Path}", path);
    }

    public Task DeleteFileAsync(string path)
    {
        var fullPath = SafePath.GetSafePath(StorageDir, path)
            ?? throw new ArgumentException($"Invalid path: {path}");

        if (File.Exists(fullPath))
            File.Delete(fullPath);

        return Task.CompletedTask;
    }

    public Task CreateFolderAsync(string path)
    {
        var fullPath = SafePath.GetSafePath(StorageDir, path)
            ?? throw new ArgumentException($"Invalid path: {path}");

        Directory.CreateDirectory(fullPath);
        _logger.LogInformation("Created folder: {Path}", path);
        return Task.CompletedTask;
    }

    public Task DeleteFolderAsync(string path)
    {
        var fullPath = SafePath.GetSafePath(StorageDir, path)
            ?? throw new ArgumentException($"Invalid path: {path}");

        if (Directory.Exists(fullPath))
            Directory.Delete(fullPath, recursive: true);

        return Task.CompletedTask;
    }

    public Task MoveAsync(string source, string destination)
    {
        var srcPath = SafePath.GetSafePath(StorageDir, source)
            ?? throw new ArgumentException($"Invalid source path: {source}");
        var destPath = SafePath.GetSafePath(StorageDir, destination)
            ?? throw new ArgumentException($"Invalid destination path: {destination}");

        Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);

        if (File.Exists(srcPath))
            File.Move(srcPath, destPath);
        else if (Directory.Exists(srcPath))
            Directory.Move(srcPath, destPath);
        else
            throw new FileNotFoundException($"Source not found: {source}");

        return Task.CompletedTask;
    }

    public Task RenameAsync(string path, string newName)
    {
        if (!SafePath.IsValidName(newName))
            throw new ArgumentException($"Invalid name: {newName}");

        var fullPath = SafePath.GetSafePath(StorageDir, path)
            ?? throw new ArgumentException($"Invalid path: {path}");

        var parentDir = Path.GetDirectoryName(fullPath)!;
        var newPath = Path.Combine(parentDir, newName);

        if (File.Exists(fullPath))
            File.Move(fullPath, newPath);
        else if (Directory.Exists(fullPath))
            Directory.Move(fullPath, newPath);
        else
            throw new FileNotFoundException($"Not found: {path}");

        return Task.CompletedTask;
    }

    public async Task ClearLoadedAsync()
    {
        _context.State.JobLoaded = null;

        if (File.Exists(CurrentCachePath))
            File.Delete(CurrentCachePath);

        await _settingsManager.SaveSettings(new System.Text.Json.Nodes.JsonObject { ["lastLoadedFile"] = null });

        // Only broadcast server-state-updated (not gcode-updated) — matching V1 behavior.
        // The client watches jobLoaded becoming null to trigger its local clear.
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogInformation("Cleared loaded G-code");
    }

    private void UpdateJobLoaded(string filename, int totalLines, bool isTemporary, string? sourcePath = null, double? estimatedSec = null)
    {
        _context.State.JobLoaded = new JobInfo
        {
            Filename = filename,
            TotalLines = totalLines,
            LoadedAt = DateTime.UtcNow,
            IsTemporary = isTemporary,
            SourceFile = sourcePath,
            EstimatedSec = estimatedSec
        };

        _ = _broadcaster.Broadcast("gcode-updated",
            new WsGcodeUpdated(filename, totalLines), NcSenderJsonContext.Default.WsGcodeUpdated);
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
    }

    private async Task<double?> CalculateEstimateAsync(string content)
    {
        try
        {
            var firmware = await _firmwareService.GetCachedAsync();
            var settings = firmware?.Settings;

            (double x, double y, double z)? vmaxMmPerMin = null;
            (double x, double y, double z)? accelMmPerSec2 = null;
            double junctionDeviationMm = 0.01;
            double rapidMmPerMin = 6000;

            if (settings is not null)
            {
                // $110/$111/$112 = max rate X/Y/Z (mm/min)
                double.TryParse(settings.GetValueOrDefault("110")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var vx);
                double.TryParse(settings.GetValueOrDefault("111")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var vy);
                double.TryParse(settings.GetValueOrDefault("112")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var vz);
                if (vx > 0 || vy > 0 || vz > 0)
                    vmaxMmPerMin = (vx, vy, vz);

                // $120/$121/$122 = acceleration X/Y/Z (mm/sec²)
                double.TryParse(settings.GetValueOrDefault("120")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ax);
                double.TryParse(settings.GetValueOrDefault("121")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ay);
                double.TryParse(settings.GetValueOrDefault("122")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var az);
                if (ax > 0 || ay > 0 || az > 0)
                    accelMmPerSec2 = (ax, ay, az);

                // $11 = junction deviation (mm)
                if (settings.TryGetValue("11", out var s11) && double.TryParse(s11.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var jd) && jd > 0)
                    junctionDeviationMm = jd;

                // Rapid = min of valid per-axis max rates, fallback 6000
                var rates = new[] { vx, vy, vz }.Where(v => v > 0).ToArray();
                if (rates.Length > 0)
                    rapidMmPerMin = rates.Min();
            }

            var analyzer = new GCodePreAnalyzer(
                rapidMmPerMin: rapidMmPerMin,
                defaultFeedMmPerMin: 1000,
                vmaxMmPerMin: vmaxMmPerMin,
                accelMmPerSec2: accelMmPerSec2,
                junctionDeviationMm: junctionDeviationMm);

            var totalSec = analyzer.Analyze(content);
            return totalSec > 0 ? Math.Round(totalSec) : null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to calculate G-code estimate");
            return null;
        }
    }

    private List<GcodeFileEntry> BuildTree(string dir, string relativePath)
    {
        var entries = new List<GcodeFileEntry>();

        if (!Directory.Exists(dir))
            return entries;

        foreach (var subDir in Directory.GetDirectories(dir).OrderBy(d => d))
        {
            var name = Path.GetFileName(subDir);
            if (name.StartsWith('.')) continue;
            var relPath = string.IsNullOrEmpty(relativePath) ? name : $"{relativePath}/{name}";
            entries.Add(new GcodeFileEntry
            {
                Id = GcodeFileEntry.GeneratePathId(relPath),
                Name = name,
                Type = "folder",
                Path = relPath,
                Children = BuildTree(subDir, relPath)
            });
        }

        foreach (var file in Directory.GetFiles(dir).OrderBy(f => f))
        {
            var name = Path.GetFileName(file);
            if (name.StartsWith('.')) continue;
            var relPath = string.IsNullOrEmpty(relativePath) ? name : $"{relativePath}/{name}";
            var info = new FileInfo(file);
            entries.Add(new GcodeFileEntry
            {
                Id = GcodeFileEntry.GeneratePathId(relPath),
                Name = name,
                Type = "file",
                Path = relPath,
                Size = info.Length,
                UploadedAt = info.CreationTimeUtc
            });
        }

        return entries;
    }
}
