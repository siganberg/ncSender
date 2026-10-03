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

    // These settings change what GetAllAsync returns, so every client gets the
    // new list.
    private static readonly string[] LibraryShapingKeys = ["numbering", "count", "probe", "probeToolNumber"];

    private void OnSettingsSaved(System.Text.Json.Nodes.JsonObject patch)
    {
        if (patch["tool"] is not System.Text.Json.Nodes.JsonObject tool) return;
        if (!LibraryShapingKeys.Any(tool.ContainsKey)) return;
        _ = BroadcastLibraryAsync();
    }

    // "tools-updated" carries what tool changes use (GetAllAsync), the list the
    // tool buttons are built from. The Tool Library tab reads the stored
    // library itself (GetLibraryAsync).
    private async Task BroadcastLibraryAsync()
    {
        try
        {
            var tools = await GetAllAsync();
            await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast the tool library");
        }
    }

    /// <summary>
    /// Installs from before Tool Numbering have no setting yet. Anyone who kept
    /// tools in the library (or had "Use Tool Library" on) stays on Tool ID;
    /// everyone else gets Slot, the classic default. Decided once and saved; a
    /// value the user set is never touched.
    /// </summary>
    public async Task DecideNumberingAsync()
    {
        if (_settings.GetSetting(ToolNumbering.Setting) is not null) return;
        var legacy = _settings.GetSetting("tool.useLibrary");
        var toolId = legacy is not null
            ? legacy.GetValue<bool>()
            : (await LoadAsync()).Count > 0;
        var value = toolId ? ToolNumbering.ToolId : ToolNumbering.Slot;
        await _settings.SaveSettings(new System.Text.Json.Nodes.JsonObject
        {
            ["tool"] = new System.Text.Json.Nodes.JsonObject { ["numbering"] = value }
        });
        _logger.LogInformation("Tool Numbering not set yet: {Value} ({Reason})", value,
            legacy is not null ? "from Use Tool Library" : toolId ? "the library has tools" : "the library is empty");
    }

    /// <summary>
    /// The tools as tool changes see them. Every reader that resolves a T number
    /// (tool changes, plugins, the pendant, the tool buttons, TLO writeback)
    /// comes through here, so this is the one place that decides what M6 T&lt;n&gt;
    /// loads: the stored library with Tool ID numbering, or the slots with Slot
    /// numbering (<see cref="SlotLibraryAsync"/>).
    /// </summary>
    public async Task<List<ToolInfo>> GetAllAsync()
    {
        return ToolNumbering.IsSlot(_settings) ? await SlotLibraryAsync() : await LoadAsync();
    }

    /// <summary>The stored Tool Library, as the Tool Library tab edits it.</summary>
    public Task<List<ToolInfo>> GetLibraryAsync() => LoadAsync();

    public async Task<ToolInfo?> GetByIdAsync(int id)
    {
        var tools = await LoadAsync();
        return tools.FirstOrDefault(t => t.Id == id);
    }

    /// <summary>
    /// Slot numbering: T&lt;n&gt; is slot n. Each slot (and the probe slot) gives the
    /// tool the library puts there, with its name and lengths, numbered n; an
    /// empty slot gives a plain "Tool n" (negative Id: never stored, so nothing
    /// is written to it). Tools in no slot aren't reachable by a T number.
    /// </summary>
    private async Task<List<ToolInfo>> SlotLibraryAsync()
    {
        var stored = await LoadAsync();
        var count = Math.Max(0, _settings.GetSetting<int>("tool.count", 0));
        var slots = Enumerable.Range(1, count).ToList();
        if (_settings.GetSetting<bool>("tool.probe", false))
        {
            var probe = _settings.GetSetting<int>("tool.probeToolNumber", 99);
            if (probe > count) slots.Add(probe);
        }
        var probeSlot = slots.Count > count ? slots[^1] : -1;

        return slots.Select(n =>
        {
            var tool = stored.FirstOrDefault(t => t.ToolNumber == n);
            if (tool is null)
                return new ToolInfo { Id = -n, ToolId = n, ToolNumber = n, Type = n == probeSlot ? "probe" : "flat" };
            tool.ToolId = n;   // a fresh copy from disk; the stored tool keeps its own ID
            return tool;
        }).ToList();
    }

    /// <summary>
    /// Writes a measured or plugin-set offset onto the stored tool, and nothing
    /// else: the list tool changes read can carry a slot number as the Tool ID,
    /// so saving that whole object back would renumber the tool. Null for a
    /// plain slot tool (nothing is stored) or an unknown Id.
    /// </summary>
    public async Task<ToolInfo?> UpdateOffsetsAsync(int id, double? tlo = null, double? x = null, double? y = null, double? z = null)
    {
        if (id <= 0) return null;
        var tools = await LoadAsync();
        var tool = tools.FirstOrDefault(t => t.Id == id);
        if (tool is null) return null;
        if (tlo.HasValue) tool.Offsets.Tlo = tlo.Value;
        if (x.HasValue) tool.Offsets.X = x.Value;
        if (y.HasValue) tool.Offsets.Y = y.Value;
        if (z.HasValue) tool.Offsets.Z = z.Value;
        await SaveAsync(tools);
        await BroadcastLibraryAsync();
        return tool;
    }

    public async Task<ToolInfo> AddAsync(ToolInfo tool)
    {
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
        await BroadcastLibraryAsync();

        return tool;
    }

    public async Task<ToolInfo?> UpdateAsync(int id, ToolInfo tool)
    {
        if (id <= 0) return null;   // a plain slot tool: nothing is stored
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
        await BroadcastLibraryAsync();

        return tool;
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var tools = await LoadAsync();
        var removed = tools.RemoveAll(t => t.Id == id);
        if (removed == 0) return false;

        await SaveAsync(tools);
        await BroadcastLibraryAsync();
        return true;
    }

    public async Task BulkUpdateAsync(List<ToolInfo> tools)
    {
        foreach (var tool in tools)
            Validate(tool);

        // Assign IDs to any tools missing them
        var maxId = tools.Where(t => t.Id > 0).Select(t => t.Id).DefaultIfEmpty(0).Max();
        foreach (var tool in tools.Where(t => t.Id <= 0))
            tool.Id = ++maxId;

        await SaveAsync(tools);
        await BroadcastLibraryAsync();
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
