using System.Text.Json;
using System.Text.Json.Nodes;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Configuration;

public class SettingsManager : ISettingsManager
{
    private readonly string _settingsPath;
    private readonly object _lock = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private JsonObject _settings;

    public SettingsManager() : this(PathUtils.GetSettingsPath()) { }

    public SettingsManager(string settingsPath)
    {
        _settingsPath = settingsPath;
        _settings = LoadFromDisk();
    }

    public JsonNode? GetSetting(string key, JsonNode? fallback = null)
    {
        lock (_lock)
        {
            var value = GetNestedValue(_settings, key);
            return value ?? fallback;
        }
    }

    public T? GetSetting<T>(string key, T? fallback = default)
    {
        var node = GetSetting(key);
        if (node is null)
            return fallback;

        try
        {
            // Use GetValue<T> for primitives — works in AOT without reflection.
            // Deserialize<T> requires the System.Text.Json serializer which needs
            // source-gen metadata for each type in Native AOT builds.
            return node.GetValue<T>();
        }
        catch
        {
            return fallback;
        }
    }

    public async Task SaveSettings(JsonObject newSettings)
    {
        lock (_lock)
        {
            DeepMerge(_settings, newSettings);
        }

        await PersistToDisk();
    }

    public JsonObject ReadAll()
    {
        lock (_lock)
        {
            // Return a deep copy of the in-memory settings to prevent external mutation.
            // The in-memory state is always current via SaveSettings/DeepMerge.
            // Re-reading from disk here caused race conditions with concurrent
            // PersistToDisk writes (non-atomic File.WriteAllTextAsync could be read
            // mid-truncation, falling back to CreateDefaults and losing connection
            // settings, which triggered spurious "setup-required" status).
            return _settings.DeepClone().AsObject();
        }
    }

    public async Task RemoveSetting(string key)
    {
        lock (_lock)
        {
            RemoveNestedValue(_settings, key);
        }

        await PersistToDisk();
    }

    private JsonObject LoadFromDisk()
    {
        if (!File.Exists(_settingsPath))
            return CreateDefaults();

        try
        {
            var json = File.ReadAllText(_settingsPath);
            var parsed = JsonNode.Parse(json)?.AsObject();
            if (parsed is not null)
                return parsed;
        }
        catch
        {
            // Corrupted file — start fresh with defaults
        }

        return CreateDefaults();
    }

    private async Task PersistToDisk()
    {
        string json;
        lock (_lock)
        {
            // Use WriteTo(Utf8JsonWriter) instead of ToJsonString(JsonSerializerOptions)
            // to avoid relying on JsonSerializer which can fail in AOT when
            // JsonSerializerOptions lacks a TypeInfoResolver.
            using var ms = new System.IO.MemoryStream();
            using (var writer = new System.Text.Json.Utf8JsonWriter(ms, new System.Text.Json.JsonWriterOptions { Indented = true }))
            {
                _settings.WriteTo(writer);
            }
            json = System.Text.Encoding.UTF8.GetString(ms.ToArray());
        }

        // Serialize disk writes so concurrent PATCHes don't race on the temp file.
        await _writeLock.WaitAsync();
        try
        {
            var dir = Path.GetDirectoryName(_settingsPath)!;
            Directory.CreateDirectory(dir);

            // Atomic write: write to a temp file then rename, so a crash or concurrent
            // write never leaves a truncated/corrupt settings.json on disk.
            var tmpPath = _settingsPath + ".tmp";
            await File.WriteAllTextAsync(tmpPath, json);
            File.Move(tmpPath, _settingsPath, overwrite: true);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static JsonNode? GetNestedValue(JsonObject obj, string path)
    {
        var parts = path.Split('.');
        JsonNode? current = obj;

        foreach (var part in parts)
        {
            if (current is not JsonObject currentObj || !currentObj.ContainsKey(part))
                return null;

            current = currentObj[part];
        }

        return current;
    }

    private static void RemoveNestedValue(JsonObject obj, string path)
    {
        var parts = path.Split('.');
        JsonObject current = obj;

        for (int i = 0; i < parts.Length - 1; i++)
        {
            if (current[parts[i]] is not JsonObject next)
                return;
            current = next;
        }

        current.Remove(parts[^1]);
    }

    /// <summary>
    /// Recursively merge source into target. Source values overwrite target values.
    /// Nested objects are merged recursively.
    /// </summary>
    private static void DeepMerge(JsonObject target, JsonObject source)
    {
        foreach (var (key, sourceValue) in source)
        {
            if (sourceValue is JsonObject sourceObj
                && target[key] is JsonObject targetObj)
            {
                DeepMerge(targetObj, sourceObj);
            }
            else
            {
                target[key] = sourceValue?.DeepClone();
            }
        }
    }

    private static JsonObject CreateDefaults()
    {
        var json = """
        {
            "pauseBeforeStop": 500,
            "pollingInterval": 100,
            "connection": {
                "type": "usb",
                "ip": "192.168.5.1",
                "port": 23,
                "protocol": "telnet",
                "serverPort": 8090,
                "usbPort": "",
                "baudRate": 115200
            },
            "theme": "dark",
            "workspace": "G54",
            "defaultGcodeView": "top",
            "autoFit": false,
            "accentColor": "#1abc9c",
            "gradientColor": "#34d399",
            "autoClearConsole": true,
            "debugLogging": false,
            "unitsPreference": "metric",
            "homeLocation": "back-left",
            "keyboardBindings": {
                "ArrowUp": "JogYPlus",
                "ArrowDown": "JogYMinus",
                "ArrowLeft": "JogXMinus",
                "ArrowRight": "JogXPlus",
                "PageUp": "JogZPlus",
                "PageDown": "JogZMinus",
                "Escape": "JogCancel"
            },
            "keyboard": {
                "shortcutsEnabled": true,
                "step": 1,
                "xyFeedRate": 3000,
                "zFeedRate": 1500
            },
            "features": {
                "keyboardShortcuts": true
            },
            "consoleBufferSize": 1000,
            "lastLoadedFile": null,
            "enableStateDeltaBroadcast": true,
            "probe": {
                "type": "autozero-touch",
                "probingAxis": "Z",
                "selectedCorner": "BottomLeft",
                "typeInitialized": false,
                "requireConnectionTest": false,
                "bitDiameters": [2, 3.175, 6.35, 9.525, 12]
            },
            "tool": {
                "count": 0,
                "source": null,
                "tls": false,
                "manual": false
            },
            "plugins": {
                "allowPriorityReordering": false
            },
            "useDoorAsPause": true,
            "remoteControl": {
                "enabled": false
            },
            "showPendant": false,
            "pendant": {
                "serialPort": "auto",
                "baudRate": 115200,
                "autoConnect": true
            }
        }
        """;

        return JsonNode.Parse(json)!.AsObject();
    }
}
