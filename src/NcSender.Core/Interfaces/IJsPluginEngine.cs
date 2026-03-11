using System.Text.Json;
using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IJsPluginEngine
{
    void LoadPlugin(string pluginId, string commandsFilePath, Dictionary<string, JsonElement> settings);
    void UnloadPlugin(string pluginId);
    bool HasPlugin(string pluginId);
    List<ProcessedCommand> ProcessOnBeforeCommand(
        string pluginId,
        List<ProcessedCommand> commands,
        CommandProcessorContext context,
        List<ToolInfo> tools);
    List<string> GetLoadedPluginIds();
    void ProcessOnAfterJobEnd(string pluginId);
}
