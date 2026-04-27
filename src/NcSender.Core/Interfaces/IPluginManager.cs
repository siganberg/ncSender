using System.Text.Json;
using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IPluginManager
{
    List<PluginInfo> ListAll();
    List<PluginInfo> ListLoaded();
    void Enable(string pluginId);
    void Disable(string pluginId);
    void Reorder(List<string> pluginIds);
    Task InstallAsync(Stream zipStream, string? filename = null);
    Task InstallFromUrlAsync(string url);
    void Uninstall(string pluginId);
    Dictionary<string, JsonElement> GetSettings(string pluginId);
    void SaveSettings(string pluginId, Dictionary<string, JsonElement> settings);
    void Reload(string pluginId);
    List<PluginToolMenuItem> GetToolMenuItems();
    string? GetConfigUi(string pluginId);
    bool HasConfig(string pluginId);
    string? GetIconPath(string pluginId);
    string? GetPluginFilePath(string pluginId, string filename);
    Task<PluginUpdateInfo> CheckUpdateAsync(string pluginId);
    Task UpdateAsync(string pluginId);
    PluginDialogInfo? GetPluginMessageDialog(string normalizedName, string messageCode);
    string ApplyOnGcodeProgramLoad(string content, IReadOnlyDictionary<string, object?> context);
}
