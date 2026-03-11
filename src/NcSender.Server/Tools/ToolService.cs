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
    }

    public async Task<List<ToolInfo>> GetAllAsync()
    {
        return await LoadAsync();
    }

    public async Task<ToolInfo?> GetByIdAsync(int id)
    {
        var tools = await LoadAsync();
        return tools.FirstOrDefault(t => t.Id == id);
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
        await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);

        return tool;
    }

    public async Task<ToolInfo?> UpdateAsync(int id, ToolInfo tool)
    {
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
        var tools = await LoadAsync();
        var removed = tools.RemoveAll(t => t.Id == id);
        if (removed == 0) return false;

        await SaveAsync(tools);
        await _broadcaster.Broadcast("tools-updated", tools, NcSenderJsonContext.Default.ListToolInfo);
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
