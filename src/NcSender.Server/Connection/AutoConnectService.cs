using System.IO.Ports;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Connection;

public class AutoConnectService : BackgroundService
{
    private readonly ICncController _controller;
    private readonly ISettingsManager _settings;
    private readonly IPendantManager _pendantManager;
    private readonly ILogger<AutoConnectService> _logger;

    private volatile bool _inhibited;
    private string _lastSettingsHash = "";
    private int _scanIndex;
    private string? _lastLoggedScanPort;

    public AutoConnectService(
        ICncController controller,
        ISettingsManager settings,
        IPendantManager pendantManager,
        ILogger<AutoConnectService> logger)
    {
        _controller = controller;
        _settings = settings;
        _pendantManager = pendantManager;
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
        // Don't attempt connection if connection type hasn't been configured yet
        var rawType = _settings.GetSetting<string>("connection.type");
        if (string.IsNullOrEmpty(rawType))
            return;

        var settings = BuildConnectionSettings();
        var currentHash = ComputeSettingsHash(settings);

        // If settings changed, disconnect to reconnect with new settings
        if (_controller.IsConnected && currentHash != _lastSettingsHash && _lastSettingsHash != "")
        {
            _logger.LogInformation("Connection settings changed, reconnecting...");
            _controller.Disconnect();
        }

        _lastSettingsHash = currentHash;

        if (_controller.IsConnected)
            return;

        var type = settings.Type.ToLowerInvariant();

        // Ethernet: connect directly to configured IP (no scanning needed)
        if (type == "ethernet")
        {
            if (string.IsNullOrEmpty(settings.Ip) || settings.Port <= 0)
                return;
            await TryConnectToTarget(settings, $"ethernet ({settings.Ip}:{settings.Port})", ct);
            return;
        }

        // USB: scan ports and try round-robin
        if (settings.BaudRate <= 0)
            return;

        var savedPort = settings.UsbPort ?? "";
        var candidatePorts = GetUsbCandidatePorts(savedPort);

        if (candidatePorts.Count == 0)
            return;

        // Pick next port in round-robin
        if (_scanIndex >= candidatePorts.Count)
            _scanIndex = 0;

        var port = candidatePorts[_scanIndex];
        _scanIndex++;

        var probeSettings = new ConnectionSettings
        {
            Type = settings.Type,
            UsbPort = port,
            BaudRate = settings.BaudRate,
            Ip = settings.Ip,
            Port = settings.Port,
            Protocol = settings.Protocol,
            ServerPort = settings.ServerPort
        };
        var target = $"usb ({port} @ {settings.BaudRate})";

        // Log only when we move to a new port (avoid spam)
        if (port != _lastLoggedScanPort)
        {
            _logger.LogInformation("Auto-connect probing {Target}...", target);
            _lastLoggedScanPort = port;
        }

        await TryConnectToTarget(probeSettings, target, ct);

        // Wait for the controller to be fully connected (greeting received +
        // first status report parsed). Poll rather than fixed delay because
        // FluidNC over WiFi can take 8-10s to finish booting and emit its
        // canonical Grbl greeting, while grblHAL is sub-second. Bail early
        // if the transport drops on its own (e.g. CncController hits its
        // own greeting timeout).
        if (_controller.IsTransportOpen && !_controller.IsConnected)
        {
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
            while (DateTime.UtcNow < deadline)
            {
                await Task.Delay(200, ct);
                if (_controller.IsConnected) break;
                if (!_controller.IsTransportOpen) break;
            }

            if (!_controller.IsConnected)
            {
                _logger.LogInformation("No CNC greeting on {Port}, trying next port", port);
                _controller.Disconnect();
            }
        }

        // On successful connection with greeting, update saved port if it changed
        // But only if user selected a specific port (not Auto-Detect)
        if (_controller.IsConnected && _controller.ActiveProtocol is not null
            && !string.IsNullOrEmpty(savedPort) && port != savedPort)
        {
            _logger.LogInformation("CNC controller found on {Port} (saved port was {SavedPort}), updating settings", port, savedPort);
            _ = _settings.SaveSettings(new System.Text.Json.Nodes.JsonObject
            {
                ["connection"] = new System.Text.Json.Nodes.JsonObject { ["usbPort"] = port }
            });
        }
    }

    private async Task TryConnectToTarget(ConnectionSettings settings, string target, CancellationToken ct)
    {
        try
        {
            await _controller.ConnectAsync(settings, ct);
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Auto-connect to {Target} failed: {Error}", target, ex.Message);
        }
    }

    // macOS built-in ports that should never be probed during auto-detect
    private static readonly string[] ExcludedPorts =
    [
        "debug-console", "Bluetooth-Incoming-Port", "Bluetooth", "wlan-debug", "DJI"
    ];

    private static bool IsExcludedPort(string port)
    {
        foreach (var excluded in ExcludedPorts)
        {
            if (port.Contains(excluded, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    private List<string> GetUsbCandidatePorts(string savedPort)
    {
        var occupiedPorts = _pendantManager.GetOccupiedPorts();
        var allPorts = SerialPort.GetPortNames();
        var isAutoDetect = string.IsNullOrEmpty(savedPort);
        var seen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var port in allPorts)
        {
            // Skip ports occupied by pendant/dongle
            if (occupiedPorts.Contains(port))
                continue;

            // Skip non-CNC ports (Bluetooth, debug console, DJI, etc.)
            if (IsExcludedPort(port))
                continue;

            // macOS dedup: prefer /dev/cu.* over /dev/tty.*
            var key = NormalizeMacPort(port);
            if (!seen.ContainsKey(key))
                seen[key] = port;
            else if (port.StartsWith("/dev/cu.", StringComparison.Ordinal))
                seen[key] = port;
        }

        var candidates = seen.Values.ToList();

        // Put saved port first if it's available
        if (!string.IsNullOrEmpty(savedPort))
        {
            var idx = candidates.FindIndex(p => string.Equals(p, savedPort, StringComparison.OrdinalIgnoreCase)
                || string.Equals(NormalizeMacPort(p), NormalizeMacPort(savedPort), StringComparison.OrdinalIgnoreCase));
            if (idx > 0)
            {
                var saved = candidates[idx];
                candidates.RemoveAt(idx);
                candidates.Insert(0, saved);
            }
        }

        return candidates;
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

    private static string NormalizeMacPort(string port)
    {
        if (port.StartsWith("/dev/cu.", StringComparison.Ordinal))
            return "/dev/tty." + port[8..];
        return port;
    }

    private static string ComputeSettingsHash(ConnectionSettings s) =>
        $"{s.Type}|{s.UsbPort}|{s.BaudRate}|{s.Ip}|{s.Port}|{s.Protocol}";
}
