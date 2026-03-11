using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Macros;

public class MacroService : IMacroService
{
    private const int MinId = 9001;
    private const int MaxId = 9999;

    private readonly ILogger<MacroService> _logger;
    private readonly string _macrosDir;

    public MacroService(ILogger<MacroService> logger)
    {
        _logger = logger;
        _macrosDir = PathUtils.GetMacrosDir();
    }

    public List<MacroInfo> ListMacros()
    {
        var macros = new List<MacroInfo>();

        if (!Directory.Exists(_macrosDir))
            return macros;

        foreach (var file in Directory.GetFiles(_macrosDir, "*.macro").OrderBy(f => f))
        {
            var macro = LoadMacroFromFile(file);
            if (macro is not null)
                macros.Add(macro);
        }

        return macros;
    }

    public MacroInfo? GetMacro(int id)
    {
        var path = GetMacroPath(id);
        if (!File.Exists(path)) return null;
        return LoadMacroFromFile(path);
    }

    public async Task<MacroInfo> CreateMacroAsync(MacroInfo macro)
    {
        // Auto-assign next available ID if none provided
        if (macro.Id == 0)
        {
            var (nextId, _, _) = GetNextAvailableId();
            if (nextId < 0)
                throw new InvalidOperationException($"No available macro IDs ({MinId}-{MaxId} range exhausted)");
            macro.Id = nextId;
        }

        if (macro.Id < MinId || macro.Id > MaxId)
            throw new ArgumentException($"Macro ID must be between {MinId} and {MaxId}");

        var path = GetMacroPath(macro.Id);
        if (File.Exists(path))
            throw new InvalidOperationException($"Macro {macro.Id} already exists");

        macro.CreatedAt = DateTime.UtcNow;
        macro.UpdatedAt = DateTime.UtcNow;

        var content = BuildMacroContent(macro);
        await File.WriteAllTextAsync(path, content);

        return LoadMacroFromFile(path)!;
    }

    public async Task<MacroInfo?> UpdateMacroAsync(int id, MacroInfo macro)
    {
        var path = GetMacroPath(id);
        if (!File.Exists(path)) return null;

        var existing = LoadMacroFromFile(path);
        if (existing is null) return null;

        macro.Id = id;
        macro.CreatedAt = existing.CreatedAt;
        macro.UpdatedAt = DateTime.UtcNow;

        var content = BuildMacroContent(macro);
        await File.WriteAllTextAsync(path, content);

        return LoadMacroFromFile(path);
    }

    public Task<bool> DeleteMacroAsync(int id)
    {
        var path = GetMacroPath(id);
        if (!File.Exists(path)) return Task.FromResult(false);

        File.Delete(path);
        return Task.FromResult(true);
    }

    public (int nextId, int minId, int maxId) GetNextAvailableId()
    {
        var usedIds = new HashSet<int>();

        if (Directory.Exists(_macrosDir))
        {
            foreach (var file in Directory.GetFiles(_macrosDir, "*.macro"))
            {
                var name = Path.GetFileNameWithoutExtension(file);
                if (int.TryParse(name, out var id))
                    usedIds.Add(id);
            }
        }

        for (var i = MinId; i <= MaxId; i++)
        {
            if (!usedIds.Contains(i))
                return (i, MinId, MaxId);
        }

        return (-1, MinId, MaxId);
    }

    private string GetMacroPath(int id) => Path.Combine(_macrosDir, $"{id}.macro");

    private MacroInfo? LoadMacroFromFile(string path)
    {
        try
        {
            var filename = Path.GetFileNameWithoutExtension(path);
            if (!int.TryParse(filename, out var id))
                return null;

            var content = File.ReadAllText(path);
            var (name, description) = ParseMacroHeader(content);
            var body = ExtractBody(content);
            var fileInfo = new FileInfo(path);

            return new MacroInfo
            {
                Id = id,
                Name = name,
                Description = description,
                Body = body,
                Content = content,
                CreatedAt = fileInfo.CreationTimeUtc,
                UpdatedAt = fileInfo.LastWriteTimeUtc
            };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load macro from {Path}", path);
            return null;
        }
    }

    internal static (string name, string description) ParseMacroHeader(string content)
    {
        var name = "";
        var description = "";

        foreach (var line in content.Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("(") || !trimmed.EndsWith(")"))
                continue;

            var inner = trimmed[1..^1].Trim();

            if (inner.StartsWith("PROGRAM:", StringComparison.OrdinalIgnoreCase))
            {
                name = inner["PROGRAM:".Length..].Trim();
            }
            else if (inner.StartsWith("DESC:", StringComparison.OrdinalIgnoreCase))
            {
                description = inner["DESC:".Length..].Trim();
            }
        }

        return (name, description);
    }

    internal static string ExtractBody(string content)
    {
        var lines = content.Split('\n');
        var bodyLines = new List<string>();
        var headerDone = false;

        foreach (var line in lines)
        {
            var trimmed = line.Trim();

            if (!headerDone)
            {
                // Only skip known header metadata lines, not arbitrary comments
                if (string.IsNullOrWhiteSpace(trimmed))
                    continue;
                if (trimmed.StartsWith("(") && trimmed.EndsWith(")"))
                {
                    var inner = trimmed[1..^1].Trim();
                    if (inner.StartsWith("PROGRAM:", StringComparison.OrdinalIgnoreCase) ||
                        inner.StartsWith("DESC:", StringComparison.OrdinalIgnoreCase))
                        continue;
                }
                headerDone = true;
            }

            bodyLines.Add(line);
        }

        return string.Join('\n', bodyLines).TrimEnd();
    }

    private static string BuildMacroContent(MacroInfo macro)
    {
        var lines = new List<string>();

        if (!string.IsNullOrWhiteSpace(macro.Name))
            lines.Add($"( PROGRAM: {macro.Name} )");

        if (!string.IsNullOrWhiteSpace(macro.Description))
            lines.Add($"( DESC: {macro.Description} )");

        if (lines.Count > 0)
            lines.Add("");

        var body = !string.IsNullOrWhiteSpace(macro.Body) ? macro.Body : macro.Content;
        if (!string.IsNullOrWhiteSpace(body))
            lines.Add(body);

        return string.Join('\n', lines);
    }
}
