using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;


namespace NcSender.Server.CommandHistory;

public class CommandHistoryService : ICommandHistoryService
{
    private const int MaxHistory = 500;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly IBroadcaster _broadcaster;
    private readonly ILogger<CommandHistoryService> _logger;
    private readonly string _filePath;
    private readonly List<string> _history = [];
    private readonly object _lock = new();

    public CommandHistoryService(IBroadcaster broadcaster, ILogger<CommandHistoryService> logger)
        : this(broadcaster, logger, PathUtils.GetCommandHistoryPath())
    {
    }

    internal CommandHistoryService(IBroadcaster broadcaster, ILogger<CommandHistoryService> logger, string filePath)
    {
        _broadcaster = broadcaster;
        _logger = logger;
        _filePath = filePath;
        Load();
    }

    public List<string> GetHistory()
    {
        lock (_lock)
        {
            return [.. _history];
        }
    }

    public async Task AddCommandAsync(string command)
    {
        if (string.IsNullOrWhiteSpace(command))
            return;

        var trimmed = command.Trim();

        lock (_lock)
        {
            // Skip consecutive duplicates
            if (_history.Count > 0 && _history[^1] == trimmed)
                return;

            _history.Add(trimmed);

            // Trim to max size
            while (_history.Count > MaxHistory)
                _history.RemoveAt(0);
        }

        await PersistAsync();
        await _broadcaster.Broadcast("command-history-appended", new WsCommandHistoryAppended(trimmed), NcSenderJsonContext.Default.WsCommandHistoryAppended);
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_filePath)) return;

            var json = File.ReadAllText(_filePath);
            var items = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.ListString);
            if (items is not null)
            {
                lock (_lock)
                {
                    _history.Clear();
                    _history.AddRange(items);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load command history");
        }
    }

    private async Task PersistAsync()
    {
        try
        {
            List<string> snapshot;
            lock (_lock)
            {
                snapshot = [.. _history];
            }

            var json = JsonSerializer.Serialize(snapshot, NcSenderJsonContext.Default.ListString);
            await File.WriteAllTextAsync(_filePath, json);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist command history");
        }
    }
}
