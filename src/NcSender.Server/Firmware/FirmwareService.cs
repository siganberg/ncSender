using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Firmware;

public class FirmwareService : IFirmwareService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly ICncController _controller;
    private readonly ILogger<FirmwareService> _logger;
    private FirmwareData? _cached;
    private string? _loadedProtocol;
    private bool _isInitializing;

    public FirmwareService(ICncController controller, ILogger<FirmwareService> logger)
    {
        _controller = controller;
        _logger = logger;
    }

    private string GetProtocolKey() =>
        _controller.ActiveProtocol?.CacheKey ?? "grblhal";

    private string GetFilePath() =>
        PathUtils.GetFirmwarePath(GetProtocolKey());

    private void EnsureLoaded()
    {
        var protocol = GetProtocolKey();
        if (_loadedProtocol != protocol)
        {
            _cached = null;
            _loadedProtocol = protocol;
            Load();
        }
    }

    public Task<FirmwareData?> GetCachedAsync()
    {
        EnsureLoaded();
        return Task.FromResult(_cached);
    }

    public async Task<FirmwareData?> RefreshAsync(bool force = false)
    {
        EnsureLoaded();

        if (!_controller.IsConnected)
            return _cached;

        if (_isInitializing)
            return _cached;

        _isInitializing = true;

        try
        {
            _logger.LogInformation("Refreshing firmware settings from controller...");

            // Query firmware version
            var versionResponse = await QueryCommand("$I", 3000);
            var version = ParseFirmwareVersion(versionResponse);
            _logger.LogInformation("Firmware version: {Version}", version);

            // Check if we need structure update (groups, definitions, HAL details)
            var needsStructure = force || _cached is null || _cached.FirmwareVersion != version;

            if (needsStructure && (_controller.ActiveProtocol?.SupportsSettingEnumeration ?? true))
            {
                _logger.LogInformation("Querying firmware structure ($EG, $ES, $ESH)...");

                var egResponse = await QueryCommand("$EG", 5000);
                var esResponse = await QueryCommand("$ES", 10000);
                var eshResponse = await QueryCommand("$ESH", 5000);

                var groups = ParseSettingGroups(egResponse);
                var settings = ParseSettingDefinitions(esResponse);
                var halSettings = ParseSettingsHAL(eshResponse);

                var firmware = new FirmwareData
                {
                    Version = "1.0",
                    FirmwareVersion = version,
                    Timestamp = DateTime.UtcNow.ToString("o"),
                    Groups = groups,
                    Settings = new Dictionary<string, FirmwareSetting>()
                };

                foreach (var (id, setting) in settings)
                {
                    firmware.Settings[id] = setting;
                    if (halSettings.TryGetValue(id, out var hal))
                        setting.HalDetails = hal;
                    if (setting.GroupId.HasValue && groups.TryGetValue(setting.GroupId.Value.ToString(), out var group))
                        setting.Group = group;
                }

                _cached = firmware;
            }

            // Always refresh current values
            _logger.LogInformation("Refreshing firmware values with $$...");
            var valuesResponse = await QueryCommand("$$", 5000);
            var currentValues = ParseCurrentValues(valuesResponse);

            _cached ??= new FirmwareData
            {
                Version = "1.0",
                FirmwareVersion = version,
                Timestamp = DateTime.UtcNow.ToString("o")
            };

            foreach (var (id, value) in currentValues)
            {
                if (_cached.Settings.TryGetValue(id, out var existing))
                {
                    existing.Value = value;
                }
                else
                {
                    _cached.Settings[id] = new FirmwareSetting
                    {
                        Id = int.TryParse(id, out var n) ? n : 0,
                        Value = value
                    };
                }
            }

            _cached.Timestamp = DateTime.UtcNow.ToString("o");

            var filePath = GetFilePath();
            var json = JsonSerializer.Serialize(_cached, NcSenderJsonContext.Default.FirmwareData);
            Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
            await File.WriteAllTextAsync(filePath, json);
            _logger.LogInformation("Cached {Count} firmware settings to {Path}", _cached.Settings.Count, filePath);

            return _cached;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to refresh firmware");
            return _cached;
        }
        finally
        {
            _isInitializing = false;
        }
    }

    private async Task<string> QueryCommand(string command, int timeoutMs)
    {
        var lines = new List<string>();

        void OnData(string data, string? sourceId)
        {
            lines.Add(data);
        }

        _controller.DataReceived += OnData;
        try
        {
            // SendCommandAsync blocks until the controller responds with "ok" or "error",
            // by which point all data lines have already been collected via DataReceived.
            using var cts = new CancellationTokenSource(timeoutMs);
            await _controller.SendCommandAsync(command, new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });

            return string.Join("\n", lines);
        }
        finally
        {
            _controller.DataReceived -= OnData;
        }
    }

    private static string? ParseFirmwareVersion(string response)
    {
        foreach (var line in response.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("[VER:", StringComparison.OrdinalIgnoreCase))
            {
                // [VER:1.1f.20250407:]
                var content = trimmed[5..^1]; // strip [VER: and ]
                return content;
            }
        }
        return null;
    }

    // Parse [SETTINGGROUP:<id>|<parentId>|<name>]
    private static Dictionary<string, FirmwareSettingGroup> ParseSettingGroups(string response)
    {
        var groups = new Dictionary<string, FirmwareSettingGroup>();
        foreach (var line in response.Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("[SETTINGGROUP:")) continue;
            var content = trimmed[14..^1]; // strip [SETTINGGROUP: and ]
            var parts = content.Split('|');
            if (parts.Length < 3) continue;

            groups[parts[0]] = new FirmwareSettingGroup
            {
                Id = int.TryParse(parts[0], out var id) ? id : 0,
                ParentId = int.TryParse(parts[1], out var pid) ? pid : 0,
                Name = parts[2].Trim()
            };
        }
        return groups;
    }

    // Parse [SETTING:<id>|<groupId>|<name>|{<unit>}|<dataType>|{<format>}|{<min>}|{<max>}]
    private static Dictionary<string, FirmwareSetting> ParseSettingDefinitions(string response)
    {
        var settings = new Dictionary<string, FirmwareSetting>();
        foreach (var line in response.Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("[SETTING:")) continue;
            var content = trimmed[9..^1]; // strip [SETTING: and ]
            var parts = content.Split('|');
            if (parts.Length < 5) continue;

            var id = parts[0];
            settings[id] = new FirmwareSetting
            {
                Id = int.TryParse(id, out var n) ? n : 0,
                GroupId = int.TryParse(parts[1], out var gid) ? gid : null,
                Name = parts[2] ?? "",
                Unit = string.IsNullOrEmpty(parts[3]) ? null : parts[3],
                DataType = int.TryParse(parts[4], out var dt) ? dt : 0,
                Format = parts.Length > 5 && !string.IsNullOrEmpty(parts[5]) ? parts[5] : null,
                Min = parts.Length > 6 && !string.IsNullOrEmpty(parts[6]) ? parts[6] : null,
                Max = parts.Length > 7 && !string.IsNullOrEmpty(parts[7]) ? parts[7] : null
            };
        }
        return settings;
    }

    // Parse $ESH tab-separated HAL details
    private static Dictionary<string, List<string>> ParseSettingsHAL(string response)
    {
        var hal = new Dictionary<string, List<string>>();
        foreach (var line in response.Split('\n'))
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed == "ok") continue;
            var parts = trimmed.Split('\t');
            if (parts.Length < 1 || !int.TryParse(parts[0], out _)) continue;
            hal[parts[0]] = parts[1..].ToList();
        }
        return hal;
    }

    // Parse $$: $0=10, $1=25.5
    private static Dictionary<string, string> ParseCurrentValues(string response)
    {
        var values = new Dictionary<string, string>();
        foreach (var line in response.Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith('$') || !trimmed.Contains('=')) continue;
            var eqIndex = trimmed.IndexOf('=');
            var key = trimmed[1..eqIndex]; // strip leading $
            var value = trimmed[(eqIndex + 1)..];
            values[key] = value;
        }
        return values;
    }

    public async Task SaveCacheAsync()
    {
        if (_cached is null) return;

        try
        {
            var filePath = GetFilePath();
            _cached.Timestamp = DateTime.UtcNow.ToString("o");
            var json = JsonSerializer.Serialize(_cached, NcSenderJsonContext.Default.FirmwareData);
            Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
            await File.WriteAllTextAsync(filePath, json);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to save firmware cache");
        }
    }

    private void Load()
    {
        try
        {
            var filePath = GetFilePath();
            if (!File.Exists(filePath)) return;

            var json = File.ReadAllText(filePath);
            _cached = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.FirmwareData);
            _logger.LogInformation("Loaded firmware cache from {Path}", filePath);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load firmware cache");
        }
    }
}
