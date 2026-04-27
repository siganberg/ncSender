using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Plugins;

public class PluginManager : IPluginManager
{
    private readonly ILogger<PluginManager> _logger;
    private readonly IBroadcaster _broadcaster;
    private readonly IJsPluginEngine _jsEngine;
    private readonly ISettingsManager _settingsManager;


    private string PluginsDir => PathUtils.GetPluginsDir();
    private string RegistryPath => Path.Combine(PathUtils.GetUserDataDir(), "plugins.json");

    public PluginManager(
        ILogger<PluginManager> logger,
        IBroadcaster broadcaster,
        IJsPluginEngine jsEngine,
        ISettingsManager settingsManager)
    {
        _logger = logger;
        _broadcaster = broadcaster;
        _jsEngine = jsEngine;
        _settingsManager = settingsManager;

        // Auto-load enabled command plugins on startup
        LoadEnabledCommandPlugins();
    }

    // ListAll: scan pluginsDir for subdirectories with manifest.json, merge with registry state
    public List<PluginInfo> ListAll()
    {
        var manifests = LoadManifests();
        var registry = LoadRegistry();
        var result = new List<PluginInfo>();

        foreach (var manifest in manifests)
        {
            var entry = registry.Find(r => r.Id == manifest.Id);
            result.Add(new PluginInfo
            {
                Id = manifest.Id,
                Name = manifest.Name,
                Version = manifest.Version,
                Author = manifest.Author,
                Description = manifest.Description,
                Category = manifest.Category,
                Enabled = entry?.Enabled ?? false,
                Priority = entry?.Priority ?? 0,
                Icon = manifest.Icon,
                HasIcon = !string.IsNullOrEmpty(manifest.Icon)
                    && File.Exists(Path.Combine(PluginsDir, manifest.Id, manifest.Icon)),
                Repository = manifest.Repository,
                ConfigUi = manifest.ConfigUi,
                InstalledAt = DateTime.TryParse(entry?.InstalledAt, out var dt) ? dt : DateTime.MinValue,
                UpdatedAt = DateTime.MinValue,
                Manifest = manifest
            });
        }

        return result.OrderBy(p => p.Priority).ToList();
    }

    // ListLoaded: return only enabled plugins sorted by priority
    public List<PluginInfo> ListLoaded()
    {
        return ListAll().Where(p => p.Enabled).OrderBy(p => p.Priority).ToList();
    }

    // Enable: update registry, enforce exclusive categories (tool-changer allows only one)
    public void Enable(string pluginId)
    {
        var manifests = LoadManifests();
        var manifest = manifests.Find(m => m.Id == pluginId);
        if (manifest is null) throw new ArgumentException($"Plugin '{pluginId}' not found");

        var registry = LoadRegistry();

        // Enforce exclusive categories
        if (manifest.Category == "tool-changer")
        {
            foreach (var entry in registry)
            {
                var otherManifest = manifests.Find(m => m.Id == entry.Id);
                if (otherManifest?.Category == "tool-changer" && entry.Id != pluginId)
                {
                    entry.Enabled = false;
                    _jsEngine.UnloadPlugin(entry.Id);
                }
            }
        }

        var existing = registry.Find(r => r.Id == pluginId);
        if (existing is not null)
        {
            existing.Enabled = true;
            existing.Name = manifest.Name;
            existing.Version = manifest.Version;
            existing.Category = manifest.Category;
            existing.Repository = manifest.Repository;
        }
        else
        {
            registry.Add(new PluginRegistryEntry
            {
                Id = pluginId,
                Name = manifest.Name,
                Version = manifest.Version,
                Category = manifest.Category,
                Enabled = true,
                InstalledAt = DateTime.UtcNow.ToString("o"),
                Priority = manifest.Priority > 0 ? manifest.Priority : registry.Count,
                Repository = manifest.Repository
            });
        }

        SaveRegistry(registry);

        // Load command plugin into JS engine if applicable
        TryLoadCommandPlugin(pluginId, manifest);

        // Sync tool settings from plugin config to server settings
        SyncToolSettingsOnEnable(pluginId);

        _ = _broadcaster.Broadcast("plugins:tools-changed",
            new WsPluginToolsChanged(pluginId, true), NcSenderJsonContext.Default.WsPluginToolsChanged);
        _logger.LogInformation("Plugin {PluginId} enabled", pluginId);
    }

    // Disable
    public void Disable(string pluginId)
    {
        var registry = LoadRegistry();
        var existing = registry.Find(r => r.Id == pluginId);
        if (existing is not null)
        {
            existing.Enabled = false;
            SaveRegistry(registry);
        }

        // Unload command plugin from JS engine
        _jsEngine.UnloadPlugin(pluginId);

        // Only reset tool settings if this plugin is the current tool source
        SyncToolSettingsOnDisable(pluginId);

        _ = _broadcaster.Broadcast("plugins:tools-changed",
            new WsPluginToolsChanged(pluginId, false), NcSenderJsonContext.Default.WsPluginToolsChanged);
        _logger.LogInformation("Plugin {PluginId} disabled", pluginId);
    }

    // Reorder: accept list of pluginIds, reassign priorities 0..N
    public void Reorder(List<string> pluginIds)
    {
        var registry = LoadRegistry();
        for (var i = 0; i < pluginIds.Count; i++)
        {
            var entry = registry.Find(r => r.Id == pluginIds[i]);
            if (entry is not null)
                entry.Priority = i;
        }
        SaveRegistry(registry);
    }

    // Install from ZIP stream
    public async Task InstallAsync(Stream zipStream, string? filename = null)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"ncsender-plugin-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);

        try
        {
            using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Read))
            {
                archive.ExtractToDirectory(tempDir);
            }

            // Find manifest.json - might be in a subdirectory
            var manifestPath = FindManifest(tempDir);
            if (manifestPath is null)
                throw new InvalidOperationException("No manifest.json found in plugin archive");

            var manifestDir = Path.GetDirectoryName(manifestPath)!;
            var manifestJson = await File.ReadAllTextAsync(manifestPath);
            var manifest = JsonSerializer.Deserialize(manifestJson, NcSenderJsonContext.Default.PluginManifest);
            if (manifest is null || string.IsNullOrEmpty(manifest.Id))
                throw new InvalidOperationException("Invalid plugin manifest");

            var targetDir = Path.Combine(PluginsDir, manifest.Id);
            var isUpdate = Directory.Exists(targetDir);
            if (isUpdate)
                Directory.Delete(targetDir, true);

            Directory.CreateDirectory(Path.GetDirectoryName(targetDir)!);
            MoveDirectory(manifestDir, targetDir);

            // Check exclusive category conflict for new installs
            var registry = LoadRegistry();
            var existingEntry = registry.Find(r => r.Id == manifest.Id);
            var shouldEnable = existingEntry?.Enabled ?? true;

            if (!isUpdate && shouldEnable && IsExclusiveCategory(manifest.Category))
            {
                var manifests = LoadManifests();
                var hasConflict = registry.Any(r =>
                    r.Id != manifest.Id &&
                    r.Enabled &&
                    manifests.Find(m => m.Id == r.Id)?.Category == manifest.Category);

                if (hasConflict)
                    shouldEnable = false;
            }

            var existingInstalledAt = existingEntry?.InstalledAt;
            registry.RemoveAll(r => r.Id == manifest.Id);
            registry.Add(new PluginRegistryEntry
            {
                Id = manifest.Id,
                Name = manifest.Name,
                Version = manifest.Version,
                Category = manifest.Category,
                Enabled = shouldEnable,
                InstalledAt = !string.IsNullOrEmpty(existingInstalledAt) ? existingInstalledAt : DateTime.UtcNow.ToString("o"),
                Priority = manifest.Priority > 0 ? manifest.Priority : registry.Count,
                Repository = manifest.Repository
            });
            SaveRegistry(registry);

            if (shouldEnable)
            {
                TryLoadCommandPlugin(manifest.Id, manifest);
                SyncToolSettingsOnEnable(manifest.Id);
            }

            await _broadcaster.Broadcast("plugins:tools-changed",
                new WsPluginToolsChanged(manifest.Id, shouldEnable), NcSenderJsonContext.Default.WsPluginToolsChanged);

            _logger.LogInformation("Plugin {PluginId} installed (enabled={Enabled})", manifest.Id, shouldEnable);
        }
        finally
        {
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
        }
    }

    // Install from URL
    public async Task InstallFromUrlAsync(string url)
    {
        using var http = new HttpClient();
        using var response = await http.GetAsync(url);
        response.EnsureSuccessStatusCode();
        using var stream = await response.Content.ReadAsStreamAsync();
        await InstallAsync(stream);
    }

    // Uninstall: disable first (if enabled) to clean up settings, then delete
    public void Uninstall(string pluginId)
    {
        var registry = LoadRegistry();
        var entry = registry.Find(r => r.Id == pluginId);

        if (entry?.Enabled == true)
            Disable(pluginId);

        var pluginDir = Path.Combine(PluginsDir, pluginId);
        if (Directory.Exists(pluginDir))
            Directory.Delete(pluginDir, true);

        registry = LoadRegistry();
        registry.RemoveAll(r => r.Id == pluginId);
        SaveRegistry(registry);

        _logger.LogInformation("Plugin {PluginId} uninstalled", pluginId);
    }

    // GetSettings: read from shared plugin-config dir (V1-compatible)
    // Path: {userDataDir}/plugin-config/{pluginId}/config.json
    public Dictionary<string, JsonElement> GetSettings(string pluginId)
    {
        var configPath = Path.Combine(PathUtils.GetPluginConfigDir(), pluginId, "config.json");
        if (!File.Exists(configPath))
            return new Dictionary<string, JsonElement>();

        try
        {
            var json = File.ReadAllText(configPath);
            return JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.DictionaryStringJsonElement)
                ?? new Dictionary<string, JsonElement>();
        }
        catch
        {
            return new Dictionary<string, JsonElement>();
        }
    }

    // SaveSettings: write to shared plugin-config dir (V1-compatible)
    public void SaveSettings(string pluginId, Dictionary<string, JsonElement> settings)
    {
        var configDir = Path.Combine(PathUtils.GetPluginConfigDir(), pluginId);
        Directory.CreateDirectory(configDir);

        var configPath = Path.Combine(configDir, "config.json");
        var json = JsonSerializer.Serialize(settings, NcSenderJsonContext.Default.DictionaryStringJsonElement);
        File.WriteAllText(configPath, json);

        // Reload JS engine with new settings if plugin is loaded
        if (_jsEngine.HasPlugin(pluginId))
        {
            var manifest = LoadManifest(pluginId);
            if (manifest is not null)
                TryLoadCommandPlugin(pluginId, manifest);

            // Re-sync tool settings
            SyncToolSettingsOnEnable(pluginId);
        }
    }

    // Reload: reload JS engine for command plugins
    public void Reload(string pluginId)
    {
        var manifest = LoadManifest(pluginId);
        if (manifest is not null && _jsEngine.HasPlugin(pluginId))
            TryLoadCommandPlugin(pluginId, manifest);

        _logger.LogInformation("Plugin {PluginId} reloaded", pluginId);
    }

    // GetToolMenuItems: scan loaded plugins for toolMenu entries
    public List<PluginToolMenuItem> GetToolMenuItems()
    {
        var loaded = ListLoaded();
        var items = new List<PluginToolMenuItem>();

        foreach (var plugin in loaded)
        {
            if (plugin.Manifest?.ToolMenu is null) continue;
            foreach (var entry in plugin.Manifest.ToolMenu)
            {
                items.Add(new PluginToolMenuItem
                {
                    Id = entry.Id,
                    PluginId = plugin.Id,
                    Label = entry.Label,
                    Icon = entry.Icon,
                    ClientOnly = entry.ClientOnly
                });
            }
        }

        return items;
    }

    // GetConfigUi: read HTML file
    public string? GetConfigUi(string pluginId)
    {
        var manifest = LoadManifest(pluginId);
        if (manifest is null || string.IsNullOrEmpty(manifest.ConfigUi)) return null;

        var configPath = Path.Combine(PluginsDir, pluginId, manifest.ConfigUi);
        return File.Exists(configPath) ? File.ReadAllText(configPath) : null;
    }

    // HasConfig
    public bool HasConfig(string pluginId)
    {
        var manifest = LoadManifest(pluginId);
        if (manifest is null || string.IsNullOrEmpty(manifest.ConfigUi)) return false;

        var configPath = Path.Combine(PluginsDir, pluginId, manifest.ConfigUi);
        return File.Exists(configPath);
    }

    // GetIconPath
    public string? GetIconPath(string pluginId)
    {
        var manifest = LoadManifest(pluginId);
        if (manifest is null || string.IsNullOrEmpty(manifest.Icon)) return null;

        var iconPath = Path.Combine(PluginsDir, pluginId, manifest.Icon);
        return File.Exists(iconPath) ? iconPath : null;
    }

    public string? GetPluginFilePath(string pluginId, string filename)
    {
        if (string.IsNullOrWhiteSpace(filename)) return null;

        var pluginDir = Path.GetFullPath(Path.Combine(PluginsDir, pluginId));
        var filePath = Path.GetFullPath(Path.Combine(pluginDir, filename));

        // Prevent path traversal
        if (!filePath.StartsWith(pluginDir, StringComparison.Ordinal)) return null;

        return File.Exists(filePath) ? filePath : null;
    }

    // CheckUpdate: fetch latest GitHub release, compare versions
    public async Task<PluginUpdateInfo> CheckUpdateAsync(string pluginId)
    {
        var manifest = LoadManifest(pluginId);
        if (manifest is null)
            return new PluginUpdateInfo { CurrentVersion = "", LatestVersion = "" };

        var result = new PluginUpdateInfo { CurrentVersion = manifest.Version };

        if (string.IsNullOrEmpty(manifest.Repository)) return result;

        try
        {
            var repoPath = ExtractGitHubRepoPath(manifest.Repository);
            if (repoPath is null) return result;

            using var http = new HttpClient();
            http.DefaultRequestHeaders.Add("User-Agent", "ncSender");
            var releaseUrl = $"https://api.github.com/repos/{repoPath}/releases/latest";
            var json = await http.GetStringAsync(releaseUrl);
            using var doc = JsonDocument.Parse(json);
            var tagName = doc.RootElement.GetProperty("tag_name").GetString() ?? "";
            var latestVersion = tagName.TrimStart('v');
            result.LatestVersion = latestVersion;
            result.UpdateAvailable = latestVersion != manifest.Version;

            if (doc.RootElement.TryGetProperty("html_url", out var htmlUrl))
                result.ReleaseUrl = htmlUrl.GetString() ?? "";

            if (doc.RootElement.TryGetProperty("published_at", out var publishedAt))
                result.PublishedAt = publishedAt.GetString();

            if (doc.RootElement.TryGetProperty("body", out var body))
                result.ReleaseNotes = body.GetString() ?? "";

            if (result.UpdateAvailable && doc.RootElement.TryGetProperty("assets", out var assets))
            {
                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.GetProperty("name").GetString() ?? "";
                    if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        result.DownloadUrl = asset.GetProperty("browser_download_url").GetString() ?? "";
                        break;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to check updates for plugin {PluginId}", pluginId);
        }

        return result;
    }

    // Update: download latest release ZIP, extract over existing, preserve settings
    public async Task UpdateAsync(string pluginId)
    {
        var updateInfo = await CheckUpdateAsync(pluginId);
        if (!updateInfo.UpdateAvailable || string.IsNullOrEmpty(updateInfo.DownloadUrl))
            throw new InvalidOperationException("No update available");

        // Preserve settings
        var settingsPath = Path.Combine(PluginsDir, pluginId, "settings.json");
        string? savedSettings = File.Exists(settingsPath) ? await File.ReadAllTextAsync(settingsPath) : null;

        await InstallFromUrlAsync(updateInfo.DownloadUrl);

        // Restore settings
        if (savedSettings is not null)
        {
            settingsPath = Path.Combine(PluginsDir, pluginId, "settings.json");
            await File.WriteAllTextAsync(settingsPath, savedSettings);
        }

        _logger.LogInformation("Plugin {PluginId} updated to {Version}", pluginId, updateInfo.LatestVersion);
    }

    // --- Plugin message dialog ---

    public PluginDialogInfo? GetPluginMessageDialog(string normalizedName, string messageCode)
    {
        try
        {
            var plugins = ListLoaded();
            var plugin = plugins.Find(p =>
                NormalizePluginId(p.Id).Equals(normalizedName, StringComparison.OrdinalIgnoreCase));

            if (plugin?.Manifest?.Messages is null || plugin.Manifest.Messages.Count == 0)
                return null;

            if (!plugin.Manifest.Messages.TryGetValue(messageCode, out var config))
            {
                // Try stripping trailing tool number suffix (e.g. LOAD_MESSAGE_MANUAL_5 → LOAD_MESSAGE_MANUAL)
                var lastUnderscore = messageCode.LastIndexOf('_');
                if (lastUnderscore > 0 && int.TryParse(messageCode[(lastUnderscore + 1)..], out _))
                {
                    var baseCode = messageCode[..lastUnderscore];
                    if (!plugin.Manifest.Messages.TryGetValue(baseCode, out config))
                        return null;
                }
                else
                    return null;
            }

            var settings = GetSettings(plugin.Id);
            var abortEventGcode = settings.TryGetValue("abortEventGcode", out var abort)
                ? abort.ToString() ?? ""
                : "";

            return new PluginDialogInfo
            {
                PluginId = plugin.Id,
                Title = config.Title,
                Message = config.Message,
                ContinueLabel = config.ContinueLabel,
                AbortEventGcode = abortEventGcode
            };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get plugin message dialog for {Name}:{Code}", normalizedName, messageCode);
            return null;
        }
    }

    private static string NormalizePluginId(string pluginId)
    {
        var lastDot = pluginId.LastIndexOf('.');
        return lastDot >= 0 ? pluginId[(lastDot + 1)..] : pluginId;
    }

    public string ApplyOnGcodeProgramLoad(string content, IReadOnlyDictionary<string, object?> context)
    {
        try
        {
            var current = content;
            foreach (var plugin in ListLoaded())
            {
                if (plugin.Manifest?.Events is null) continue;
                if (!plugin.Manifest.Events.Any(e => string.Equals(e, "onGcodeProgramLoad", StringComparison.OrdinalIgnoreCase)))
                    continue;
                if (!_jsEngine.HasPlugin(plugin.Id)) continue;

                _logger.LogInformation("Running onGcodeProgramLoad for plugin {PluginId}", plugin.Id);
                current = _jsEngine.ProcessOnGcodeProgramLoad(plugin.Id, current, context);
            }
            return current;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply onGcodeProgramLoad transformations");
            return content;
        }
    }

    // --- Command plugin helpers ---

    private void LoadEnabledCommandPlugins()
    {
        try
        {
            var loaded = ListLoaded();
            _logger.LogInformation("Startup: {Count} enabled plugins found", loaded.Count);
            foreach (var plugin in loaded)
            {
                _logger.LogInformation("Startup: plugin {Id}, hasManifest={HasManifest}, events=[{Events}], commands={Commands}",
                    plugin.Id,
                    plugin.Manifest is not null,
                    plugin.Manifest is not null ? string.Join(",", plugin.Manifest.Events) : "",
                    plugin.Manifest?.Commands ?? "");

                if (plugin.Manifest is not null)
                {
                    try
                    {
                        TryLoadCommandPlugin(plugin.Id, plugin.Manifest);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to load command plugin {PluginId}", plugin.Id);
                    }
                }

                // Re-sync tool settings from enabled tool-changer plugins on startup
                SyncToolSettingsOnEnable(plugin.Id);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to auto-load command plugins on startup");
        }
    }

    private void TryLoadCommandPlugin(string pluginId, PluginManifest manifest)
    {
        var hasJsEvent = manifest.Events.Contains("onBeforeCommand")
            || manifest.Events.Contains("onGcodeProgramLoad")
            || manifest.Events.Contains("onAfterJobEnd");
        if (!hasJsEvent || string.IsNullOrEmpty(manifest.Commands))
        {
            _logger.LogInformation("Plugin {PluginId}: skipping load (events={Events}, commands={Commands})",
                pluginId, string.Join(",", manifest.Events), manifest.Commands);
            return;
        }

        var commandsPath = Path.Combine(PluginsDir, pluginId, manifest.Commands);
        _logger.LogInformation("Plugin {PluginId}: loading commands from {Path} (exists={Exists})",
            pluginId, commandsPath, File.Exists(commandsPath));

        if (!File.Exists(commandsPath))
        {
            _logger.LogWarning("Commands file not found for plugin {PluginId}: {Path}", pluginId, commandsPath);
            return;
        }

        var settings = GetSettings(pluginId);
        _logger.LogInformation("Plugin {PluginId}: settings keys = [{Keys}]",
            pluginId, string.Join(", ", settings.Keys));
        _jsEngine.LoadPlugin(pluginId, commandsPath, settings, manifest.Priority);
    }

    private void SyncToolSettingsOnEnable(string pluginId)
    {
        try
        {
            var settings = GetSettings(pluginId);

            // Only sync if this plugin has tool-changer settings
            var isManual = settings.ContainsKey("numberOfTools");
            var hasToolChanger = isManual || settings.ContainsKey("pockets");
            if (!hasToolChanger)
            {
                _logger.LogDebug("Plugin {PluginId} has no tool-changer settings, skipping tool sync", pluginId);
                return;
            }

            var toolSettings = new JsonObject();

            if (isManual)
            {
                // ManualToolChange: numberOfTools (min 1), manual + tls always on
                var count = settings.TryGetValue("numberOfTools", out var n)
                    ? Math.Max(1, Convert.ToInt32(n.ToString()))
                    : 1;
                toolSettings["count"] = count;
                toolSettings["manual"] = true;
                toolSettings["tls"] = true;
                toolSettings["probe"] = settings.TryGetValue("addProbe", out var addProbe)
                    && addProbe.ValueKind == JsonValueKind.True;
            }
            else
            {
                // RapidChangeATC-style: pockets for count, toolSensor for tls/probe
                if (settings.TryGetValue("pockets", out var pockets))
                    toolSettings["count"] = JsonValue.Create(Convert.ToInt32(pockets.ToString()));

                if (settings.TryGetValue("toolSensor", out var toolSensor))
                {
                    var sensorStr = toolSensor.ToString() ?? "";
                    toolSettings["tls"] = sensorStr.Contains("TLS", StringComparison.OrdinalIgnoreCase)
                        || sensorStr.Contains("Probe", StringComparison.OrdinalIgnoreCase);
                    toolSettings["probe"] = sensorStr.Contains("Probe", StringComparison.OrdinalIgnoreCase);
                }

                // Explicit addProbe setting takes precedence over sensor-derived default
                if (settings.TryGetValue("addProbe", out var addProbe))
                    toolSettings["probe"] = addProbe.ValueKind == JsonValueKind.True;

                toolSettings["manual"] = true;
            }

            toolSettings["source"] = pluginId;

            var patch = new JsonObject { ["tool"] = toolSettings };
            _settingsManager.SaveSettings(patch).GetAwaiter().GetResult();
            BroadcastSettingsDelta(patch);
            _logger.LogInformation("Synced tool settings from plugin {PluginId}", pluginId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to sync tool settings on enable for plugin {PluginId}", pluginId);
        }
    }

    private void SyncToolSettingsOnDisable(string pluginId)
    {
        try
        {
            // Only reset if this plugin is the current tool source
            var currentSettings = _settingsManager.ReadAll();
            var currentSource = currentSettings["tool"]?["source"]?.GetValue<string>() ?? "";
            if (currentSource != pluginId)
            {
                _logger.LogDebug("Plugin {PluginId} is not the tool source ({Source}), skipping tool reset", pluginId, currentSource);
                return;
            }

            var toolSettings = new JsonObject
            {
                ["count"] = 0,
                ["manual"] = false,
                ["tls"] = false,
                ["probe"] = false,
                ["source"] = ""
            };
            var patch = new JsonObject { ["tool"] = toolSettings };
            _settingsManager.SaveSettings(patch).GetAwaiter().GetResult();
            BroadcastSettingsDelta(patch);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to reset tool settings on disable");
        }
    }

    private void BroadcastSettingsDelta(JsonObject patch)
    {
        using var doc = JsonDocument.Parse(patch.ToJsonString());
        _ = _broadcaster.Broadcast("settings-changed", doc.RootElement.Clone());
    }

    // --- Helpers ---

    private List<PluginManifest> LoadManifests()
    {
        var result = new List<PluginManifest>();
        if (!Directory.Exists(PluginsDir)) return result;

        foreach (var dir in Directory.GetDirectories(PluginsDir))
        {
            var manifestPath = Path.Combine(dir, "manifest.json");
            if (!File.Exists(manifestPath)) continue;

            try
            {
                var json = File.ReadAllText(manifestPath);
                var manifest = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.PluginManifest);
                if (manifest is not null && manifest.Platforms.ContainsKey("pro-v2"))
                    result.Add(manifest);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to load manifest from {Dir}", dir);
            }
        }

        return result;
    }

    private PluginManifest? LoadManifest(string pluginId)
    {
        var manifestPath = Path.Combine(PluginsDir, pluginId, "manifest.json");
        if (!File.Exists(manifestPath)) return null;

        try
        {
            var json = File.ReadAllText(manifestPath);
            return JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.PluginManifest);
        }
        catch
        {
            return null;
        }
    }

    private List<PluginRegistryEntry> LoadRegistry()
    {
        if (!File.Exists(RegistryPath))
            return [];

        try
        {
            var json = File.ReadAllText(RegistryPath);
            return JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.ListPluginRegistryEntry) ?? [];
        }
        catch
        {
            return [];
        }
    }

    private void SaveRegistry(List<PluginRegistryEntry> registry)
    {
        Directory.CreateDirectory(PluginsDir);
        var json = JsonSerializer.Serialize(registry, NcSenderJsonContext.Default.ListPluginRegistryEntry);
        File.WriteAllText(RegistryPath, json);
    }

    private static readonly HashSet<string> ExclusiveCategories = new(StringComparer.OrdinalIgnoreCase) { "tool-changer" };

    private static bool IsExclusiveCategory(string? category) =>
        !string.IsNullOrEmpty(category) && ExclusiveCategories.Contains(category);

    private static string? FindManifest(string directory)
    {
        var directManifest = Path.Combine(directory, "manifest.json");
        if (File.Exists(directManifest)) return directManifest;

        // Check one level deep (common with GitHub release zips)
        foreach (var subDir in Directory.GetDirectories(directory))
        {
            var subManifest = Path.Combine(subDir, "manifest.json");
            if (File.Exists(subManifest)) return subManifest;
        }

        return null;
    }

    /// Move a directory, falling back to recursive copy + delete when source and
    /// target are on different filesystems (EXDEV / "Invalid cross-device link").
    private static void MoveDirectory(string source, string target)
    {
        try
        {
            Directory.Move(source, target);
        }
        catch (IOException)
        {
            CopyDirectoryRecursive(source, target);
            Directory.Delete(source, true);
        }
    }

    private static void CopyDirectoryRecursive(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
        foreach (var dir in Directory.GetDirectories(source))
            CopyDirectoryRecursive(dir, Path.Combine(target, Path.GetFileName(dir)));
    }

    private static string? ExtractGitHubRepoPath(string url)
    {
        // Extract "owner/repo" from GitHub URL
        try
        {
            var uri = new Uri(url);
            if (uri.Host != "github.com") return null;
            var segments = uri.AbsolutePath.Trim('/').Split('/');
            return segments.Length >= 2 ? $"{segments[0]}/{segments[1]}" : null;
        }
        catch
        {
            return null;
        }
    }
}
