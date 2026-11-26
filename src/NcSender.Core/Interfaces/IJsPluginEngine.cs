using System.Text.Json;
using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IJsPluginEngine
{
    void LoadPlugin(string pluginId, string commandsFilePath, Dictionary<string, JsonElement> settings, int priority = 0);
    /// <summary>What the manifest asks for ("network", "files"); call before LoadPlugin.</summary>
    void SetPermissions(string pluginId, IReadOnlyCollection<string> permissions);
    /// <summary>Calls the plugin's onRequest(payload); its answer as JSON, or null without one.</summary>
    string? HandleRequest(string pluginId, string payloadJson);
    void UnloadPlugin(string pluginId);
    bool HasPlugin(string pluginId);
    Task<List<ProcessedCommand>> ProcessOnBeforeCommandAsync(
        string pluginId,
        List<ProcessedCommand> commands,
        CommandProcessorContext context,
        List<ToolInfo> tools);
    List<string> GetLoadedPluginIds();
    /// <summary>
    /// Runs onSettingsApplied(settings, info) in every loaded plugin (or one):
    /// the hook where a plugin publishes what follows from its settings, so
    /// nobody has to open its settings page and press Save after an update.
    /// </summary>
    void NotifySettingsApplied(string reason, string? pluginId = null);
    void ProcessOnAfterJobEnd(string pluginId);
    string ProcessOnGcodeProgramLoad(string pluginId, string content, IReadOnlyDictionary<string, object?> context);
}
