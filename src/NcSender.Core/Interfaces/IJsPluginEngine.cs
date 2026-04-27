using System.Text.Json;
using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IJsPluginEngine
{
    void LoadPlugin(string pluginId, string commandsFilePath, Dictionary<string, JsonElement> settings, int priority = 0);
    void UnloadPlugin(string pluginId);
    bool HasPlugin(string pluginId);
    List<ProcessedCommand> ProcessOnBeforeCommand(
        string pluginId,
        List<ProcessedCommand> commands,
        CommandProcessorContext context,
        List<ToolInfo> tools);
    List<string> GetLoadedPluginIds();
    void ProcessOnAfterJobEnd(string pluginId);
    string ProcessOnGcodeProgramLoad(string pluginId, string content, IReadOnlyDictionary<string, object?> context);
}
