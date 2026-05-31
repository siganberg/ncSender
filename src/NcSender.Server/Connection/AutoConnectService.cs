using System.IO.Ports;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.SystemApi;

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

            var ethTarget = $"ethernet ({settings.Protocol} {settings.Ip}:{settings.Port})";

            // Log only when target changes (avoid spam on per-second retries)
            if (ethTarget != _lastLoggedScanPort)
            {
                _logger.LogInformation("Auto-connect probing {Target}...", ethTarget);
                _lastLoggedScanPort = ethTarget;
            }

            await TryConnectToTarget(settings, ethTarget, ct);
            return;
        }

        // USB: scan ports and try round-robin
        if (settings.BaudRate <= 0)
            return;

        var savedPort = settings.UsbPort ?? "";
        var savedDescriptor = _settings.GetSetting<string>("connection.usbDescriptor") ?? "";
        var candidatePorts = GetUsbCandidatePorts(savedPort, savedDescriptor);

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

        // On successful connection, persist the device's USB descriptor (if the
        // OS exposes one) so a later renumber — e.g. Linux flipping
        // /dev/ttyACM0 → /dev/ttyACM1 after $REBOOT — can find the same
        // device by metadata instead of falling back to slow probe-by-connect.
        // Also fix up usbPort if the device showed up at a different path
        // than the saved one.
        if (_controller.IsConnected && _controller.ActiveProtocol is not null
            && !string.IsNullOrEmpty(savedPort))
        {
            var descriptor = SystemEndpoints.GetSerialPortManufacturer(port) ?? "";
            var portChanged = port != savedPort;
            var descriptorChanged = descriptor != savedDescriptor;

            if (portChanged || descriptorChanged)
            {
                if (portChanged)
                    _logger.LogInformation("CNC controller found on {Port} (saved port was {SavedPort}), updating settings", port, savedPort);

                var connectionPatch = new System.Text.Json.Nodes.JsonObject { ["usbPort"] = port };
                // Only persist descriptor when the OS gave us one; otherwise
                // leave whatever was there alone (Windows currently returns null).
                if (!string.IsNullOrEmpty(descriptor))
                    connectionPatch["usbDescriptor"] = descriptor;

                _ = _settings.SaveSettings(new System.Text.Json.Nodes.JsonObject
                {
                    ["connection"] = connectionPatch
                });
            }
        }
    }

    private string _lastLoggedFailure = "";

    private async Task TryConnectToTarget(ConnectionSettings settings, string target, CancellationToken ct)
    {
        try
        {
            await _controller.ConnectAsync(settings, ct);
            _lastLoggedFailure = "";
        }
        catch (Exception ex)
        {
            // Log first failure for a given target at Info; subsequent retries stay Debug
            // so we don't spam, but the user always sees that auto-connect is failing.
            var failureKey = $"{target}|{ex.Message}";
            if (failureKey != _lastLoggedFailure)
            {
                _logger.LogInformation("Auto-connect to {Target} failed: {Error}", target, ex.Message);
                _lastLoggedFailure = failureKey;
            }
            else
            {
                _logger.LogDebug("Auto-connect to {Target} failed: {Error}", target, ex.Message);
            }
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

    private List<string> GetUsbCandidatePorts(string savedPort, string savedDescriptor)
    {
        // Auto-Detect is disabled: only probe the user-selected port.
        // Avoids round-robin probing of Bluetooth devices and other non-CNC ports,
        // and makes retry-on-disconnect fast (stays on the same port).
        if (string.IsNullOrEmpty(savedPort))
            return new List<string>();

        var occupiedPorts = _pendantManager.GetOccupiedPorts();
        var allPorts = SerialPort.GetPortNames();
        var savedKey = NormalizeMacPort(savedPort);

        // macOS: prefer /dev/cu.* over /dev/tty.* when both exist. tty.* enforces
        // POSIX terminal semantics (DCD wait, line discipline) and silently drops
        // serial data even though the port appears to open successfully.
        var cuMatch = allPorts.FirstOrDefault(p =>
            p.StartsWith("/dev/cu.", StringComparison.Ordinal)
            && string.Equals(NormalizeMacPort(p), savedKey, StringComparison.OrdinalIgnoreCase));

        var match = cuMatch ?? allPorts.FirstOrDefault(p =>
            string.Equals(p, savedPort, StringComparison.OrdinalIgnoreCase));

        // Fallback: saved port no longer exists (e.g. Linux renumbered the
        // device to ttyACM1 after $REBOOT). If we previously captured the
        // USB descriptor for this device, find any port whose manufacturer
        // string matches and use that instead. Avoids slow probe-by-connect.
        if (match is null && !string.IsNullOrEmpty(savedDescriptor))
        {
            match = allPorts.FirstOrDefault(p =>
                !occupiedPorts.Contains(p)
                && string.Equals(SystemEndpoints.GetSerialPortManufacturer(p), savedDescriptor, StringComparison.Ordinal));

            if (match is not null)
            {
                _logger.LogInformation(
                    "Saved USB port {SavedPort} not present; matched descriptor '{Descriptor}' to {NewPort}",
                    savedPort, savedDescriptor, match);
            }
        }

        if (match is null || occupiedPorts.Contains(match))
            return new List<string>();

        return new List<string> { match };
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
