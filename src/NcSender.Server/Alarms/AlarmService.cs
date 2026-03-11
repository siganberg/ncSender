using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Alarms;

public class AlarmService : IAlarmService
{
    private readonly ICncController _controller;
    private readonly ILogger<AlarmService> _logger;
    private Dictionary<string, string>? _alarms;
    private string? _loadedProtocol;

    public AlarmService(ICncController controller, ILogger<AlarmService> logger)
    {
        _controller = controller;
        _logger = logger;
    }

    private string GetProtocolKey() =>
        _controller.ActiveProtocol?.CacheKey ?? "grblhal";

    private string GetFilePath() =>
        PathUtils.GetAlarmsPath(GetProtocolKey());

    private void EnsureLoaded()
    {
        var protocol = GetProtocolKey();
        if (_loadedProtocol != protocol)
        {
            _alarms = null;
            _loadedProtocol = protocol;
            Load();
        }
    }

    public string? GetAlarm(int id)
    {
        EnsureLoaded();
        if (_alarms is not null && _alarms.TryGetValue(id.ToString(), out var desc))
            return desc;
        return null;
    }

    public async Task FetchAndCacheAsync()
    {
        EnsureLoaded();

        // If we already have cached data, skip
        if (_alarms is not null && _alarms.Count > 0)
            return;

        var filePath = GetFilePath();
        if (File.Exists(filePath))
        {
            Load();
            if (_alarms is not null && _alarms.Count > 0)
                return;
        }

        if (!_controller.IsConnected)
            return;

        var protocol = _controller.ActiveProtocol;
        if (protocol is null)
            return;

        try
        {
            var command = protocol.AlarmFetchCommand;
            _logger.LogInformation("Fetching alarm codes from controller ({Protocol}, {Command})...",
                protocol.Name, command);

            var alarms = new Dictionary<string, string>();

            void OnData(string data, string? sourceId)
            {
                var parsed = protocol.ParseAlarmLine(data);
                if (parsed is not null)
                    alarms[parsed.Value.Id] = parsed.Value.Description;
            }

            _controller.DataReceived += OnData;

            try
            {
                // SendCommandAsync completes when the controller responds with "ok"
                await _controller.SendCommandAsync(command, new Core.Models.CommandOptions
                {
                    Meta = new Core.Models.CommandMeta { SourceId = "system", Silent = true }
                });
            }
            finally
            {
                _controller.DataReceived -= OnData;
            }

            if (alarms.Count > 0)
            {
                _alarms = alarms;
                var path = GetFilePath();
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var json = JsonSerializer.Serialize(alarms, NcSenderJsonContext.Default.DictionaryStringString);
                await File.WriteAllTextAsync(path, json);
                _logger.LogInformation("Cached {Count} alarm codes to {Path}", alarms.Count, path);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch alarm codes");
        }
    }

    private void Load()
    {
        try
        {
            var filePath = GetFilePath();
            if (!File.Exists(filePath)) return;

            var json = File.ReadAllText(filePath);
            _alarms = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.DictionaryStringString);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load alarm cache");
        }
    }
}
