using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Config;

public interface IConfigService
{
    Task<(string? Content, string Filename)> GetConfigWithFilenameAsync();
    Task<string?> GetConfigAsync();
    Task SaveConfigAsync(string content);
    Task<string> GetConfigFilenameAsync();
    bool CanSave { get; }
}

public class ConfigService : IConfigService
{
    private const string DefaultConfigFilename = "config.yaml";

    private readonly ISettingsManager _settings;
    private readonly ICncController _controller;
    private readonly ILogger<ConfigService> _logger;
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(15) };

    public ConfigService(ISettingsManager settings, ICncController controller, ILogger<ConfigService> logger)
    {
        _settings = settings;
        _controller = controller;
        _logger = logger;
    }

    public bool CanSave
    {
        get
        {
            var type = _settings.GetSetting<string>("connection.type")?.ToLowerInvariant();
            return type is "ethernet" or "wifi";
        }
    }

    private string GetControllerIp()
    {
        return _settings.GetSetting<string>("connection.ip")
               ?? throw new InvalidOperationException("Controller IP not configured.");
    }

    public async Task<string> GetConfigFilenameAsync()
    {
        if (!_controller.IsConnected)
            return DefaultConfigFilename;

        string? resolved = null;

        void OnData(string data, string? sourceId)
        {
            var parsed = TryParseConfigFilename(data);
            if (parsed is not null)
                resolved = parsed;
        }

        _controller.DataReceived += OnData;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await _controller.SendCommandAsync("$Config/Filename", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            }, cts.Token);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not query $Config/Filename from controller; falling back to {Default}", DefaultConfigFilename);
        }
        finally
        {
            _controller.DataReceived -= OnData;
        }

        return string.IsNullOrWhiteSpace(resolved) ? DefaultConfigFilename : resolved;
    }

    internal static string? TryParseConfigFilename(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
            return null;

        var trimmed = line.Trim();

        // Standard FluidNC response to $Config/Filename:
        // $/Config/Filename=my_config.yaml or $Config/Filename=my_config.yaml
        const string settingKey = "Config/Filename=";
        var idx = trimmed.IndexOf(settingKey, StringComparison.OrdinalIgnoreCase);
        if (idx >= 0)
        {
            var value = trimmed[(idx + settingKey.Length)..].Trim().TrimStart('/');
            return string.IsNullOrEmpty(value) ? null : value;
        }

        return null;
    }

    public async Task<string?> GetConfigAsync()
    {
        var (content, _) = await GetConfigWithFilenameAsync();
        return content;
    }

    public async Task<(string? Content, string Filename)> GetConfigWithFilenameAsync()
    {
        var ip = GetControllerIp();
        var filename = await GetConfigFilenameAsync();
        var url = $"http://{ip}/localfs/{Uri.EscapeDataString(filename)}";

        _logger.LogInformation("Fetching {Filename} from {Url}", filename, url);
        var response = await _httpClient.GetAsync(url);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Failed to fetch config ({Filename}): {Status}", filename, response.StatusCode);
            return (null, filename);
        }

        var content = await response.Content.ReadAsStringAsync();
        _logger.LogInformation("Retrieved {Filename} ({Length} chars)", filename, content.Length);
        return (content, filename);
    }

    public async Task SaveConfigAsync(string content)
    {
        if (!CanSave)
            throw new InvalidOperationException("Config upload requires ethernet or wifi connection.");

        var ip = GetControllerIp();
        var filename = await GetConfigFilenameAsync();
        _logger.LogInformation("Uploading {Filename} to FluidNC at {IP} ({Length} chars)...", filename, ip, content.Length);

        var url = $"http://{ip}/flash/{Uri.EscapeDataString(filename)}";
        var body = new StringContent(content, System.Text.Encoding.UTF8, "application/octet-stream");
        var response = await _httpClient.PutAsync(url, body);

        if (!response.IsSuccessStatusCode)
        {
            var responseBody = await response.Content.ReadAsStringAsync();
            _logger.LogWarning("FluidNC upload failed: {Status} {Body}", response.StatusCode, responseBody);
            throw new InvalidOperationException($"Upload failed: {response.StatusCode}");
        }

        _logger.LogInformation("Config ({Filename}) uploaded successfully to FluidNC", filename);
    }
}
