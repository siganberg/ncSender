using System.Text.Json.Nodes;

namespace NcSender.Core.Interfaces;

public interface ISettingsManager
{
    /// <summary>
    /// Get a setting value by dot-notation key (e.g. "connection.serverPort").
    /// Returns fallback if key not found.
    /// </summary>
    JsonNode? GetSetting(string key, JsonNode? fallback = null);

    /// <summary>
    /// Get a strongly-typed setting value.
    /// </summary>
    T? GetSetting<T>(string key, T? fallback = default);

    /// <summary>
    /// Deep-merge new settings into existing and persist to disk.
    /// </summary>
    Task SaveSettings(JsonObject newSettings);

    /// <summary>
    /// Read the entire settings object.
    /// </summary>
    JsonObject ReadAll();

    /// <summary>
    /// Remove a setting by dot-notation key.
    /// </summary>
    Task RemoveSetting(string key);
}
