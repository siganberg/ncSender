using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Tools;

public class ToolService : IToolService
{
    private static readonly string[] ValidTypes =
        ["flat", "ball", "v-bit", "drill", "chamfer", "surfacing", "probe", "thread-mill"];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly IBroadcaster _broadcaster;
    private readonly ISettingsManager _settings;
    private readonly ILogger<ToolService> _logger;
    private readonly string _filePath;

    public ToolService(IBroadcaster broadcaster, ISettingsManager settings, ILogger<ToolService> logger)
        : this(broadcaster, settings, logger, PathUtils.GetToolsPath())
    {
    }

    internal ToolService(IBroadcaster broadcaster, ISettingsManager settings, ILogger<ToolService> logger, string filePath)
    {
        _broadcaster = broadcaster;
        _settings = settings;
        _logger = logger;
        _filePath = filePath;
        _settings.SettingsSaved += OnSettingsSaved;
    }

    // These settings change what GetAllAsync returns while the library is off
    // (or switch it), so every client gets the new list.
    private static readonly string[] LibraryShapingKeys = ["useLibrary", "count", "probe", "probeToolNumber"];

    private void OnSettingsSaved(System.Text.Json.Nodes.JsonObject patch)
    {
        if (patch["tool"] is not System.Text.Json.Nodes.JsonObject tool) return;
        if (!LibraryShapingKeys.Any(tool.ContainsKey)) return;
        _ = BroadcastLibraryAsync();
    }

    private async Task BroadcastLibraryAsync()
    {
        try
        {
            var tools = await GetAllAsync();
            await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast the tool library after a settings change");
        }
    }

    /// <summary>
    /// Settings → Tool Library → "Use Tool Library". Off on a fresh install; an
    /// install from before the switch keeps the library on if it has tools in
    /// it (see <see cref="DecideUseLibraryAsync"/>).
    /// </summary>
    public const string UseLibrarySetting = "tool.useLibrary";

    private bool LibraryEnabled => _settings.GetSetting<bool>(UseLibrarySetting, false);

    /// <summary>
    /// Installs from before the switch have no setting yet. Keep the library on
    /// for anyone who already keeps tools in it, off for everyone else. Decided
    /// once and saved, so the switch, the server and every client read the same
    /// value from then on; a value the user set is never touched.
    /// </summary>
    public async Task DecideUseLibraryAsync()
    {
        if (_settings.GetSetting(UseLibrarySetting) is not null) return;
        var on = (await LoadAsync()).Count > 0;
        await _settings.SaveSettings(new System.Text.Json.Nodes.JsonObject
        {
            ["tool"] = new System.Text.Json.Nodes.JsonObject { ["useLibrary"] = on }
        });
        _logger.LogInformation("Use Tool Library not set yet: {State} ({Reason})",
            on ? "on" : "off", on ? "the library has tools" : "the library is empty");
    }

    // Every reader of the library (tool changes, plugins, the pendant, the tool
    // buttons, TLO writeback) comes through here, so this is the one place that
    // decides what M6 T<n> loads.
    public async Task<List<ToolInfo>> GetAllAsync()
    {
        return LibraryEnabled ? await LoadAsync() : BuiltInLibrary();
    }

    public async Task<ToolInfo?> GetByIdAsync(int id)
    {
        var tools = await GetAllAsync();
        return tools.FirstOrDefault(t => t.Id == id);
    }

    /// <summary>
    /// With the Tool Library off: Slot N always holds "Tool N" (Tool ID N) and
    /// nothing else, so T&lt;n&gt; is simply slot n everywhere, and the probe slot
    /// holds the probe. Ids are negative: they are never in the stored file, so a
    /// write to one (TLO writeback, a plugin's updateToolOffset) finds nothing and
    /// no tool length is kept. The stored library is left exactly as it was.
    /// </summary>
    private List<ToolInfo> BuiltInLibrary()
    {
        var count = Math.Max(0, _settings.GetSetting<int>("tool.count", 0));
        var tools = Enumerable.Range(1, count)
            .Select(n => new ToolInfo { Id = -n, ToolId = n, ToolNumber = n })
            .ToList();
        if (_settings.GetSetting<bool>("tool.probe", false))
        {
            var probe = _settings.GetSetting<int>("tool.probeToolNumber", 99);
            if (probe > count)
                tools.Add(new ToolInfo { Id = -probe, ToolId = probe, ToolNumber = probe, Type = "probe" });
        }
        return tools;
    }

    // The stored library can't be changed while it is off: what a client sees
    // then is the built-in one, and saving that back would replace the user's tools.
    private void EnsureLibraryEnabled()
    {
        if (!LibraryEnabled)
            throw new InvalidOperationException("The Tool Library is off");
    }

    public async Task<ToolInfo> AddAsync(ToolInfo tool)
    {
        EnsureLibraryEnabled();
        Validate(tool);

        var tools = await LoadAsync();

        // Check duplicate toolNumber (null means unassigned, allow multiple)
        if (tool.ToolNumber.HasValue && tools.Any(t => t.ToolNumber == tool.ToolNumber))
            throw new InvalidOperationException($"Tool number {tool.ToolNumber} already exists");

        // Check magazine size
        var magazineSize = _settings.GetSetting<int>("tool.count", 0);
        if (magazineSize > 0 && tool.ToolNumber > magazineSize)
            throw new InvalidOperationException($"Tool number {tool.ToolNumber} exceeds magazine size ({magazineSize})");

        if (tool.Id <= 0)
            tool.Id = GenerateId(tools);

        tools.Add(tool);
        await SaveAsync(tools);
        await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);

        return tool;
    }

    public async Task<ToolInfo?> UpdateAsync(int id, ToolInfo tool)
    {
        if (id <= 0) return null;   // a built-in tool: nothing is stored
        EnsureLibraryEnabled();
        Validate(tool);

        var tools = await LoadAsync();
        var index = tools.FindIndex(t => t.Id == id);
        if (index < 0) return null;

        // Check duplicate toolNumber (excluding self; null means unassigned, allow multiple)
        if (tool.ToolNumber.HasValue && tools.Any(t => t.ToolNumber == tool.ToolNumber && t.Id != id))
            throw new InvalidOperationException($"Tool number {tool.ToolNumber} already exists");

        tool.Id = id;
        tools[index] = tool;
        await SaveAsync(tools);
        await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);

        return tool;
    }

    public async Task<bool> DeleteAsync(int id)
    {
        EnsureLibraryEnabled();
        var tools = await LoadAsync();
        var removed = tools.RemoveAll(t => t.Id == id);
        if (removed == 0) return false;

        await SaveAsync(tools);
        await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);
        return true;
    }

    public async Task BulkUpdateAsync(List<ToolInfo> tools)
    {
        EnsureLibraryEnabled();
        foreach (var tool in tools)
            Validate(tool);

        // Assign IDs to any tools missing them
        var maxId = tools.Where(t => t.Id > 0).Select(t => t.Id).DefaultIfEmpty(0).Max();
        foreach (var tool in tools.Where(t => t.Id <= 0))
            tool.Id = ++maxId;

        await SaveAsync(tools);
        await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);
    }

    private static int GenerateId(List<ToolInfo> tools)
    {
        if (tools.Count == 0) return 1;
        return tools.Max(t => t.Id) + 1;
    }

    private static void Validate(ToolInfo tool)
    {
        if (string.IsNullOrWhiteSpace(tool.Name))
            throw new ArgumentException("Tool name is required");

        if (tool.Diameter <= 0)
            throw new ArgumentException("Tool diameter must be greater than 0");

        if (!ValidTypes.Contains(tool.Type))
            throw new ArgumentException($"Invalid tool type '{tool.Type}'. Valid types: {string.Join(", ", ValidTypes)}");
    }

    private async Task<List<ToolInfo>> LoadAsync()
    {
        try
        {
            if (!File.Exists(_filePath))
                return [];

            var json = await File.ReadAllTextAsync(_filePath);
            var tools = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.ListToolInfo) ?? [];

            var needsSave = false;

            // Migrate GUID IDs to integer IDs
            var maxId = tools.Where(t => t.Id > 0).Select(t => t.Id).DefaultIfEmpty(0).Max();
            foreach (var tool in tools.Where(t => t.Id <= 0))
            {
                tool.Id = ++maxId;
                needsSave = true;
            }

            // Backfill missing toolId values
            var maxToolId = tools.Where(t => t.ToolId.HasValue).Select(t => t.ToolId!.Value).DefaultIfEmpty(0).Max();
            foreach (var tool in tools.Where(t => !t.ToolId.HasValue))
            {
                tool.ToolId = ++maxToolId;
                needsSave = true;
            }

            if (needsSave)
                await SaveAsync(tools);

            return tools;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load tools");
            return [];
        }
    }

    private async Task SaveAsync(List<ToolInfo> tools)
    {
        var json = JsonSerializer.Serialize(tools, NcSenderJsonContext.Default.ListToolInfo);
        await File.WriteAllTextAsync(_filePath, json);
    }
}
