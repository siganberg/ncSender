using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Connection;

public class AutoConnectService : BackgroundService
{
    private readonly ICncController _controller;
    private readonly ISettingsManager _settings;
    private readonly ILogger<AutoConnectService> _logger;

    private volatile bool _inhibited;
    private string _lastSettingsHash = "";
    private string _lastFailedTarget = "";

    public AutoConnectService(
        ICncController controller,
        ISettingsManager settings,
        ILogger<AutoConnectService> logger)
    {
        _controller = controller;
        _settings = settings;
        _logger = logger;
    }

    public void Inhibit() => _inhibited = true;
    public void Uninhibit() => _inhibited = false;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Auto-connect service started");

        // Small initial delay to let the app settle
        await Task.Delay(1000, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!_inhibited)
                    await TryConnectAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogDebug("Auto-connect attempt failed: {Error}", ex.Message);
            }

            await Task.Delay(1000, stoppingToken);
        }

        _logger.LogInformation("Auto-connect service stopped");
    }

    private async Task TryConnectAsync(CancellationToken ct)
    {
        var settings = BuildConnectionSettings();
        var currentHash = ComputeSettingsHash(settings);

        // If settings changed, disconnect to reconnect with new settings
        if (_controller.IsConnected && currentHash != _lastSettingsHash && _lastSettingsHash != "")
        {
            _logger.LogInformation("Connection settings changed from [{OldHash}] to [{NewHash}], reconnecting...",
                _lastSettingsHash, currentHash);
            _controller.Disconnect();
        }

        _lastSettingsHash = currentHash;

        if (_controller.IsConnected)
            return;

        var type = settings.Type.ToLowerInvariant();

        // Don't attempt if settings are incomplete
        if (type == "usb" && (string.IsNullOrEmpty(settings.UsbPort) || settings.BaudRate <= 0))
            return;

        if (type == "ethernet" && (string.IsNullOrEmpty(settings.Ip) || settings.Port <= 0))
            return;

        var target = type == "usb"
            ? $"usb ({settings.UsbPort} @ {settings.BaudRate})"
            : $"ethernet ({settings.Ip}:{settings.Port})";

        var isRetry = target == _lastFailedTarget;
        if (!isRetry)
            _logger.LogInformation("Auto-connect attempting {Target}...", target);

        try
        {
            await _controller.ConnectAsync(settings, ct);
            _lastFailedTarget = "";
        }
        catch (Exception ex)
        {
            if (!isRetry)
                _logger.LogWarning("Auto-connect to {Target} failed: {Error} (retries will be silent)", target, ex.Message);
            _lastFailedTarget = target;
        }
    }

    private ConnectionSettings BuildConnectionSettings()
    {
        return new ConnectionSettings
        {
            Type = _settings.GetSetting<string>("connection.type") ?? "usb",
            UsbPort = _settings.GetSetting<string>("connection.usbPort") ?? "",
            BaudRate = _settings.GetSetting<int>("connection.baudRate", 115200),
            Ip = _settings.GetSetting<string>("connection.ip") ?? "192.168.5.1",
            Port = _settings.GetSetting<int>("connection.port", 23),
            Protocol = _settings.GetSetting<string>("connection.protocol") ?? "telnet",
            ServerPort = _settings.GetSetting<int>("connection.serverPort", 8090),
        };
    }

    private static string ComputeSettingsHash(ConnectionSettings s) =>
        $"{s.Type}|{s.UsbPort}|{s.BaudRate}|{s.Ip}|{s.Port}|{s.Protocol}";
}
