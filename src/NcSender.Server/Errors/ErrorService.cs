using System.Text.Json;
using NcSender.Core.Constants;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Errors;

public class ErrorService : IErrorService
{
    private readonly ICncController _controller;
    private readonly ILogger<ErrorService> _logger;
    private Dictionary<string, string>? _errors;
    private string? _loadedProtocol;

    public ErrorService(ICncController controller, ILogger<ErrorService> logger)
    {
        _controller = controller;
        _logger = logger;
    }

    private string GetProtocolKey() =>
        _controller.ActiveProtocol?.CacheKey ?? "grblhal";

    private string GetFilePath() =>
        PathUtils.GetErrorsPath(GetProtocolKey());

    private void EnsureLoaded()
    {
        var protocol = GetProtocolKey();
        if (_loadedProtocol != protocol)
        {
            _errors = null;
            _loadedProtocol = protocol;
            Load();
        }
    }

    public string? GetError(int code)
    {
        EnsureLoaded();
        if (_errors is not null && _errors.TryGetValue(code.ToString(), out var desc))
            return desc;
        return GrblErrors.GetMessage(code) is var fallback && fallback != "Unknown error" ? fallback : null;
    }

    public async Task FetchAndCacheAsync()
    {
        EnsureLoaded();

        var protocol = _controller.ActiveProtocol;
        if (protocol is null)
            return;

        var command = protocol.ErrorFetchCommand;
        if (command is null)
            return;

        var filePath = GetFilePath();
        var greeting = _controller.GreetingMessage ?? "";

        // Check if cached version matches current firmware
        if (_errors is not null && _errors.Count > 0)
            return;

        if (File.Exists(filePath))
        {
            Load();
            if (_errors is not null && _errors.Count > 0
                && _errors.TryGetValue("_greeting", out var cachedGreeting)
                && cachedGreeting == greeting)
                return;
        }

        if (!_controller.IsConnected)
            return;

        try
        {
            _logger.LogInformation("Fetching error codes from controller ({Protocol}, {Command})...",
                protocol.Name, command);

            var errors = new Dictionary<string, string>();

            void OnData(string data, string? sourceId)
            {
                var parsed = protocol.ParseErrorLine(data);
                if (parsed is not null)
                    errors[parsed.Value.Id] = parsed.Value.Description;
            }

            _controller.DataReceived += OnData;

            try
            {
                await _controller.SendCommandAsync(command, new Core.Models.CommandOptions
                {
                    Meta = new Core.Models.CommandMeta { SourceId = "system", Silent = true }
                });
            }
            finally
            {
                _controller.DataReceived -= OnData;
            }

            if (errors.Count > 0)
            {
                errors["_greeting"] = greeting;
                _errors = errors;
                Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
                var json = JsonSerializer.Serialize(errors, NcSenderJsonContext.Default.DictionaryStringString);
                await File.WriteAllTextAsync(filePath, json);
                _logger.LogInformation("Cached {Count} error codes to {Path}", errors.Count - 1, filePath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch error codes");
        }
    }

    private void Load()
    {
        try
        {
            var filePath = GetFilePath();
            if (!File.Exists(filePath)) return;

            var json = File.ReadAllText(filePath);
            _errors = JsonSerializer.Deserialize(json, NcSenderJsonContext.Default.DictionaryStringString);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load error cache");
        }
    }
}
