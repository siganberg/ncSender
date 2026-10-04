namespace NcSender.Server.Plugins;

/// <summary>
/// A plugin's onBeforeCommand threw. The command is refused rather than sent
/// without the plugin's lines (a dust boot left down, a tool change without
/// its sequence).
/// </summary>
public sealed class PluginCommandException(string pluginId, string message, Exception inner)
    : Exception($"Plugin {pluginId} failed: {message}", inner)
{
    public string PluginId { get; } = pluginId;
}
