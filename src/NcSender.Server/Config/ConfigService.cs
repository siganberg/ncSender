using NcSender.Core.Interfaces;

namespace NcSender.Server.Config;

public interface IConfigService
{
    Task<string?> GetConfigAsync();
    Task SaveConfigAsync(string content);
    bool CanSave { get; }
}

public class ConfigService : IConfigService
{
    private readonly ISettingsManager _settings;
    private readonly ILogger<ConfigService> _logger;
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(15) };

    public ConfigService(ISettingsManager settings, ILogger<ConfigService> logger)
    {
        _settings = settings;
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

    public async Task<string?> GetConfigAsync()
    {
        var ip = GetControllerIp();
        var url = $"http://{ip}/localfs/config.yaml";

        _logger.LogInformation("Fetching config.yaml from {Url}", url);
        var response = await _httpClient.GetAsync(url);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Failed to fetch config: {Status}", response.StatusCode);
            return null;
        }

        var content = await response.Content.ReadAsStringAsync();
        _logger.LogInformation("Retrieved config.yaml ({Length} chars)", content.Length);
        return content;
    }

    public async Task SaveConfigAsync(string content)
    {
        if (!CanSave)
            throw new InvalidOperationException("Config upload requires ethernet or wifi connection.");

        var ip = GetControllerIp();
        _logger.LogInformation("Uploading config.yaml to FluidNC at {IP} ({Length} chars)...", ip, content.Length);

        var url = $"http://{ip}/flash/config.yaml";
        var body = new StringContent(content, System.Text.Encoding.UTF8, "application/octet-stream");
        var response = await _httpClient.PutAsync(url, body);

        if (!response.IsSuccessStatusCode)
        {
            var responseBody = await response.Content.ReadAsStringAsync();
            _logger.LogWarning("FluidNC upload failed: {Status} {Body}", response.StatusCode, responseBody);
            throw new InvalidOperationException($"Upload failed: {response.StatusCode}");
        }

        _logger.LogInformation("Config uploaded successfully to FluidNC");
    }
}
