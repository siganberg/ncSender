using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Pendant;

public class PendantManager : IPendantManager
{
    private readonly ILogger<PendantManager> _logger;
    private readonly ICncController _controller;
    private readonly IBroadcaster _broadcaster;
    private readonly IServerContext _serverContext;
    private readonly IJobManager _jobManager;
    private readonly ICommandProcessor _commandProcessor;
    private readonly ISettingsManager _settingsManager;
    private PendantSerialHandler? _serialHandler;  // Active data handler (dongle preferred, USB fallback)
    private PendantWifiInfo? _lastWifiInfo;
    private CancellationTokenSource? _flashCts;
    private const string FirmwareRepo = "siganberg/ncSender.pendant.releases";

    // Pendant connection state
    private bool _pendantConnected;
    private long _lastPongTicks;
    private Timer? _keepAliveTimer;
    private Action<string>? _otaResponseHandler;
    private bool _otaInProgress;
    private PendantSettingsSnapshot? _lastSentSettings;
    private PendantDroSnapshot? _lastSentDro;

    // Dual-connection tracking (scanner manages discovery, we manage usage)
    private PendantPortScanner? _scanner;
    private PendantSerialHandler? _pendantUsbHandler;  // Direct USB to pendant (for OTA + fallback data)
    private PendantSerialHandler? _dongleHandler;       // Dongle connection (for ESP-NOW data)
    private Action<string>? _donglePromotionListener;   // Watches dongle for pings to prove it's paired

    // Client metadata for broadcasts — updated when pendant sends client:metadata
    private PendantClientMeta _clientMeta = new(
        ClientId: "usb-pendant",
        Ip: "usb",
        IsLocal: true,
        Product: "ncSenderPendant",
        DeviceId: null,
        Version: null,
        Licensed: false
    );

    private const int PingIntervalMs = 1000;
    private const int PingTimeoutMs = 3000;

    public PendantManager(
        ILogger<PendantManager> logger,
        ICncController controller,
        IBroadcaster broadcaster,
        IServerContext serverContext,
        IJobManager jobManager,
        ICommandProcessor commandProcessor,
        ISettingsManager settingsManager)
    {
        _logger = logger;
        _controller = controller;
        _broadcaster = broadcaster;
        _serverContext = serverContext;
        _jobManager = jobManager;
        _commandProcessor = commandProcessor;
        _settingsManager = settingsManager;

        // Subscribe to status reports for DRO broadcasting
        _controller.StatusReportReceived += OnStatusReportReceived;

        // Start pendant auto-connect once CNC controller is connected
        _controller.ConnectionStatusChanged += (status, isConnected) =>
        {
            if (isConnected) StartAutoConnect();
        };
    }

    private void OnStatusReportReceived(MachineState state)
    {
        if (_serialHandler?.IsConnected == true && _pendantConnected && !_otaInProgress)
        {
            _ = SendDroAsync(full: false);
        }
    }

    #region IPendantManager — Status & Activation

    public PendantStatus GetStatus()
    {
        // Use _pendantConnected (handshake completed) not just port open — V1 parity
        var usbConnected = _pendantConnected && _serialHandler?.IsConnected == true;

        var usbInfo = usbConnected
            ? new PendantDeviceInfo
            {
                Id = _serialHandler!.DeviceId ?? "",
                Name = "USB Pendant",
                Port = _serialHandler.ConnectedPort ?? "",
                Version = _serialHandler.DeviceVersion ?? "",
                DeviceId = _serialHandler.DeviceId ?? "",
                DeviceModel = _serialHandler.DeviceModel ?? "",
                Licensed = _serialHandler.Licensed
            }
            : null;

        // Active connection type based on which handler is active
        var isDongleActive = _dongleHandler is not null && _serialHandler == _dongleHandler;
        var activeType = usbConnected
            ? (isDongleActive ? "espnow" : "usb")
            : "none";

        // pendantConnectionType: what V1 client reads for toolbar icon
        var pendantConnectionType = usbConnected ? activeType : null;

        // OTA requires direct USB to pendant — available when pendant USB handler is connected
        var otaReady = usbConnected && _pendantUsbHandler is { IsConnected: true };

        return new PendantStatus
        {
            ConnectionState = usbConnected ? "connected" : "disconnected",
            UsbPendant = usbInfo,
            PendantEnabled = usbConnected,
            ActiveConnectionType = activeType,
            PendantConnectionType = pendantConnectionType,
            OtaReady = otaReady
        };
    }

    private const string ActivationApiUrl = "https://franciscreation.com/api/license/activate";
    private const string ActivationApiKey = "ncsp-2025-fc-api-key";
    private const string PendantPluginId = "com.ncsender.wireless-pendant";

    public async Task ActivateWifiAsync(string installationId, string deviceId, string pendantIp)
    {
        // Call activation server
        _logger.LogInformation("Calling activation server for WiFi pendant");
        using var http = new HttpClient();
        var activationResponse = await http.PostAsync(ActivationApiUrl,
            new StringContent(
                $$$"""{"installationId":"{{{installationId}}}","machineHash":"{{{deviceId}}}","product":"ncSenderPendant"}""",
                System.Text.Encoding.UTF8, "application/json")
            { Headers = { { "X-Api-Key", ActivationApiKey } } });

        var activationText = await activationResponse.Content.ReadAsStringAsync();
        if (!activationResponse.IsSuccessStatusCode)
        {
            var error = "Activation failed";
            try { var doc = System.Text.Json.JsonDocument.Parse(activationText); error = doc.RootElement.GetProperty("error").GetString() ?? error; } catch { }
            throw new InvalidOperationException(error);
        }

        // Send license to pendant via WiFi HTTP
        _logger.LogInformation("Sending license to pendant at {Ip}", pendantIp);
        var pendantResponse = await http.PostAsync($"http://{pendantIp}/api/activate",
            new StringContent(activationText, System.Text.Encoding.UTF8, "application/json"));

        if (!pendantResponse.IsSuccessStatusCode)
        {
            var pendantText = await pendantResponse.Content.ReadAsStringAsync();
            var error = $"Pendant activation failed (HTTP {(int)pendantResponse.StatusCode})";
            try { var doc = System.Text.Json.JsonDocument.Parse(pendantText); error = doc.RootElement.GetProperty("error").GetString() ?? error; } catch { }
            throw new InvalidOperationException(error);
        }

        _logger.LogInformation("License activated via WiFi");
    }

    public async Task ActivateUsbAsync(string installationId)
    {
        if (_serialHandler is not { IsConnected: true })
            throw new InvalidOperationException("USB pendant not connected");

        var deviceId = _serialHandler.DeviceId;
        if (string.IsNullOrEmpty(deviceId))
            throw new InvalidOperationException("Device ID not available. Please reconnect the pendant.");

        // Call activation server
        _logger.LogInformation("Calling activation server for USB pendant");
        using var http = new HttpClient();
        var activationResponse = await http.PostAsync(ActivationApiUrl,
            new StringContent(
                $$$"""{"installationId":"{{{installationId}}}","machineHash":"{{{deviceId}}}","product":"ncSenderPendant"}""",
                System.Text.Encoding.UTF8, "application/json")
            { Headers = { { "X-Api-Key", ActivationApiKey } } });

        var activationText = await activationResponse.Content.ReadAsStringAsync();
        if (!activationResponse.IsSuccessStatusCode)
        {
            var error = "Activation failed";
            try { var doc = System.Text.Json.JsonDocument.Parse(activationText); error = doc.RootElement.GetProperty("error").GetString() ?? error; } catch { }
            throw new InvalidOperationException(error);
        }

        // Send license to pendant via USB serial
        var licenseData = JsonDocument.Parse(activationText).RootElement;
        await _serialHandler.SendMessageAsync(
            new PendantTypeDataMsg($"plugin:{PendantPluginId}:license-data", licenseData),
            PendantJsonContext.Default.PendantTypeDataMsg);

        // Update local state — pendant doesn't send client:metadata back
        _serialHandler.Licensed = true;
        _clientMeta = _clientMeta with { Licensed = true };
        _logger.LogInformation("License activated via USB serial");
        await _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
    }

    public async Task DeactivateWifiAsync(string pendantIp)
    {
        _logger.LogInformation("Deactivating pendant license via WiFi at {Ip}", pendantIp);

        using var http = new HttpClient();
        http.Timeout = TimeSpan.FromSeconds(10);
        var response = await http.PostAsync($"http://{pendantIp}/api/deactivate",
            new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));

        if (!response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync();
            var error = $"Deactivation failed (HTTP {(int)response.StatusCode})";
            try { var doc = System.Text.Json.JsonDocument.Parse(text); error = doc.RootElement.GetProperty("error").GetString() ?? error; } catch { }
            throw new InvalidOperationException(error);
        }

        _logger.LogInformation("License deactivated via WiFi");
    }

    public async Task DeactivateUsbAsync()
    {
        if (_serialHandler is not { IsConnected: true })
            throw new InvalidOperationException("USB pendant not connected");

        _logger.LogInformation("Deactivating pendant license via USB");
        await _serialHandler.SendMessageAsync(
            new PendantTypeMsg($"plugin:{PendantPluginId}:deactivate"),
            PendantJsonContext.Default.PendantTypeMsg);

        // Update local state — pendant doesn't send client:metadata back
        _serialHandler.Licensed = false;
        _clientMeta = _clientMeta with { Licensed = false };
        _logger.LogInformation("License deactivated via USB serial");
        await _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
    }

    #endregion

    #region IPendantManager — Firmware

    public async Task<PendantFirmwareInfo> CheckFirmwareAsync()
    {
        var result = new PendantFirmwareInfo
        {
            CurrentVersion = _serialHandler?.DeviceVersion ?? ""
        };

        try
        {
            using var http = new HttpClient();
            http.DefaultRequestHeaders.Add("User-Agent", "ncSender");
            var url = $"https://api.github.com/repos/{FirmwareRepo}/releases/latest";
            var json = await http.GetStringAsync(url);
            using var doc = JsonDocument.Parse(json);
            var tagName = doc.RootElement.GetProperty("tag_name").GetString() ?? "";
            result.LatestVersion = tagName.TrimStart('v');
            result.UpdateAvailable = IsNewerVersion(result.LatestVersion, result.CurrentVersion);

            if (result.UpdateAvailable && doc.RootElement.TryGetProperty("assets", out var assets))
            {
                // V1 logic: construct exact asset name from device model
                // Format: firmware_{model}_pendant_v{version}.bin (excludes fullreset variants)
                var deviceModel = _serialHandler?.DeviceModel;

                // VID/PID fallback (matches V1): ESP32-S3 native USB = ncsender, USB-serial bridge = pibot
                if (string.IsNullOrEmpty(deviceModel))
                    deviceModel = InferModelFromPort(_serialHandler?.ConnectedPort);

                if (!string.IsNullOrEmpty(deviceModel))
                {
                    var expectedName = $"firmware_{deviceModel}_pendant_v{result.LatestVersion}.bin";
                    foreach (var asset in assets.EnumerateArray())
                    {
                        var name = asset.GetProperty("name").GetString() ?? "";
                        if (name.Equals(expectedName, StringComparison.OrdinalIgnoreCase))
                        {
                            result.DownloadUrl = asset.GetProperty("browser_download_url").GetString() ?? "";
                            break;
                        }
                    }

                    if (string.IsNullOrEmpty(result.DownloadUrl))
                        _logger.LogWarning("Firmware asset not found: {AssetName}", expectedName);
                }
                else
                {
                    _logger.LogWarning("Cannot determine firmware variant: device model unknown");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to check pendant firmware");
        }

        return result;
    }

    public async Task UpdateFirmwareAsync(Func<double, Task>? onProgress = null)
    {
        var info = await CheckFirmwareAsync();
        if (!info.UpdateAvailable || string.IsNullOrEmpty(info.DownloadUrl))
            throw new InvalidOperationException("No firmware update available");

        using var http = new HttpClient();
        using var response = await http.GetAsync(info.DownloadUrl);
        response.EnsureSuccessStatusCode();
        using var stream = await response.Content.ReadAsStreamAsync();
        await FlashFileAsync(stream, onProgress);
    }

    public async Task FlashFileAsync(Stream firmware, Func<double, Task>? onProgress = null)
    {
        if (_serialHandler is not { IsConnected: true })
            throw new InvalidOperationException("Pendant not connected via USB");

        // OTA always goes through direct USB to pendant.
        // If active handler is dongle, use the pendant USB handler instead.
        PendantSerialHandler? otaHandler = null;
        var isDongleActive = _dongleHandler is not null && _serialHandler == _dongleHandler;
        if (isDongleActive)
        {
            if (_pendantUsbHandler is { IsConnected: true })
            {
                _logger.LogInformation("OTA: using pendant USB handler for firmware flash (dongle stays active)");
                otaHandler = _pendantUsbHandler;
            }
            else
            {
                throw new InvalidOperationException(
                    "OTA requires a direct USB connection to the pendant. " +
                    "Please connect the pendant via USB cable and try again.");
            }
        }
        // Use pendant USB handler if on dongle, otherwise use the main connection (which is USB)
        var handler = otaHandler ?? _serialHandler!;

        _flashCts = new CancellationTokenSource();

        using var ms = new MemoryStream();
        await firmware.CopyToAsync(ms);
        var data = ms.ToArray();

        // Stop keep-alive and suppress DRO during flash
        StopKeepAliveTimer();
        _otaInProgress = true;

        var tcs = new TaskCompletionSource();
        // Buffer progress from synchronous OTA handler, drain from async context
        var progressQueue = new System.Collections.Concurrent.ConcurrentQueue<double>();
        var progressSignal = new SemaphoreSlim(0);

        var inactivityTimer = new Timer(_ =>
        {
            _logger.LogError("OTA inactivity timeout (15s) — no response from pendant");
            OtaCleanup();
            StartKeepAliveTimerDelayed(7000);
            tcs.TrySetException(new TimeoutException("Firmware update timed out"));
        }, null, 15000, Timeout.Infinite);

        var chunkSize = 4096;
        var offset = 0;

        void ResetTimeout()
        {
            try { inactivityTimer.Change(15000, Timeout.Infinite); } catch { /* disposed */ }
        }

        void SendNextChunk()
        {
            if (offset >= data.Length) return;
            var end = Math.Min(offset + chunkSize, data.Length);
            handler.WriteRawBytes(data, offset, end - offset);
            offset = end;
        }

        _otaResponseHandler = (line) =>
        {
            try
            {
                _logger.LogDebug("OTA response: {Line}", line);

                if (line == "$OTA:READY")
                {
                    _logger.LogInformation("OTA: pendant ready, sending first chunk");
                    ResetTimeout();
                    SendNextChunk();
                }
                else if (line == "$OTA:ACK")
                {
                    ResetTimeout();
                    SendNextChunk();
                }
                else if (line.StartsWith("$OTA:PROGRESS:"))
                {
                    ResetTimeout();
                    if (int.TryParse(line.AsSpan(14), out var percent))
                    {
                        _logger.LogInformation("OTA progress: {Percent}%", percent);
                        progressQueue.Enqueue(percent);
                        progressSignal.Release();
                    }
                }
                else if (line == "$OTA:OK")
                {
                    OtaCleanup();
                    inactivityTimer.Dispose();
                    // Reset connection state — pendant is rebooting
                    _pendantConnected = false;
                    _lastSentDro = null;
                    _lastSentSettings = null;
                    ResetClientMeta();
                    StopKeepAliveTimer();

                    // Close the handler and release the port from the scanner.
                    // ESP32-S3 native USB CDC stays enumerated across esp_restart,
                    // but the macOS serial fd goes stale — reads/writes silently fail.
                    // Closing forces the scanner to re-open the port fresh after reboot.
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            // Brief delay for $OTA:OK to finish sending
                            await Task.Delay(500);
                            var port = handler.ConnectedPort;
                            DetachActiveHandler();
                            _serialHandler = null;
                            _pendantUsbHandler = null;
                            await handler.DisconnectAsync();
                            if (port is not null)
                                _scanner?.ReleaseDevice(port);
                            _logger.LogInformation("OTA: closed handler, scanner will re-discover port");
                        }
                        catch (Exception ex)
                        {
                            _logger.LogDebug(ex, "OTA: error closing handler after flash");
                        }
                    });

                    // Signal completion so progress drain loop exits
                    progressSignal.Release();
                    tcs.TrySetResult();
                }
                else if (line.StartsWith("$OTA:ERROR:"))
                {
                    _logger.LogError("OTA error from pendant: {Error}", line[11..]);
                    OtaCleanup();
                    inactivityTimer.Dispose();
                    StartKeepAliveTimer();
                    progressSignal.Release();
                    tcs.TrySetException(new InvalidOperationException(line[11..]));
                }
                else
                {
                    _logger.LogWarning("OTA unexpected response: {Line}", line);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OTA handler error");
                OtaCleanup();
                inactivityTimer.Dispose();
                StartKeepAliveTimer();
                progressSignal.Release();
                tcs.TrySetException(ex);
            }
        };

        // If using dedicated OTA handler, listen for responses on it instead of main handler
        if (otaHandler is not null)
        {
            otaHandler.RawMessageReceived += (line) =>
            {
                if (line.StartsWith("$OTA:"))
                    _otaResponseHandler?.Invoke(line);
            };
        }

        // Send OTA init command using raw protocol (not JSON)
        _logger.LogInformation("Sending OTA init: $OTA:{Size} ({Chunks} chunks)", data.Length, (data.Length + chunkSize - 1) / chunkSize);
        await handler.SendRawAsync($"$OTA:{data.Length}");

        try
        {
            // Drain progress from queue and report via async callback
            while (!tcs.Task.IsCompleted)
            {
                await Task.WhenAny(tcs.Task, progressSignal.WaitAsync());
                while (progressQueue.TryDequeue(out var percent))
                {
                    if (onProgress != null) await onProgress(percent);
                }
            }

            await tcs.Task; // propagate any exception
            if (onProgress != null) await onProgress(100);
            _logger.LogInformation("Pendant firmware flash completed");
        }
        catch
        {
            OtaCleanup();
            throw;
        }
        finally
        {
            // Handler is closed asynchronously in the $OTA:OK path (background task).
            // On error, handler stays open for scanner to manage.
        }
    }

    private void OtaCleanup()
    {
        _otaResponseHandler = null;
        _otaInProgress = false;
    }

    private void StartKeepAliveTimerDelayed(int delayMs)
    {
        Task.Delay(delayMs).ContinueWith(_ => StartKeepAliveTimer(), TaskScheduler.Default);
    }

    public void CancelFlash()
    {
        _flashCts?.Cancel();
        _flashCts = null;
        OtaCleanup();
        StartKeepAliveTimerDelayed(7000);
    }

    #endregion

    #region IPendantManager — WiFi

    public PendantWifiInfo? GetWifiInfo() => _lastWifiInfo;

    public async Task PushWifiAsync(PendantWifiInfo wifiInfo)
    {
        if (_serialHandler is not { IsConnected: true })
            throw new InvalidOperationException("Pendant not connected via USB");

        _lastWifiInfo = wifiInfo;
        await _serialHandler.SendMessageAsync(
            new PendantWifiConfigMsg("wifi-config", wifiInfo.Ssid, wifiInfo.Password, wifiInfo.Ip, wifiInfo.Port),
            PendantJsonContext.Default.PendantWifiConfigMsg);

        _logger.LogInformation("WiFi config pushed to pendant");
    }

    #endregion

    #region IPendantManager — Serial Connection

    public List<string> GetSerialPorts() => PendantSerialHandler.GetAvailablePorts();

    public PendantDeviceInfo? GetSerialStatus()
    {
        if (_serialHandler is not { IsConnected: true }) return null;

        return new PendantDeviceInfo
        {
            Id = _serialHandler.DeviceId ?? "",
            Name = "USB Pendant",
            Port = _serialHandler.ConnectedPort ?? "",
            Version = _serialHandler.DeviceVersion ?? "",
            DeviceId = _serialHandler.DeviceId ?? "",
            DeviceModel = _serialHandler.DeviceModel ?? "",
            Licensed = _serialHandler.Licensed
        };
    }

    public async Task ConnectSerialAsync(string port)
    {
        // Manual connect — stop scanner and connect directly
        _scanner?.Stop();

        var handler = new PendantSerialHandler(_logger);
        await handler.ConnectAsync(port);
        SetActiveHandler(handler);
        _logger.LogInformation("Manual serial connect to {Port}", port);
    }

    public async Task DisconnectSerialAsync()
    {
        _scanner?.Stop();
        StopKeepAliveTimer();

        DetachActiveHandler();
        _pendantConnected = false;

        // Close all handlers
        if (_dongleHandler is not null)
        {
            await _dongleHandler.DisconnectAsync();
            _dongleHandler = null;
        }
        if (_pendantUsbHandler is not null)
        {
            await _pendantUsbHandler.DisconnectAsync();
            _pendantUsbHandler = null;
        }
        _serialHandler = null;

        await _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
    }

    public async Task UnpairDongleAsync()
    {
        if (_dongleHandler is not { IsConnected: true })
            throw new InvalidOperationException("Dongle not connected");

        _logger.LogInformation("Sending $UNPAIR to dongle");
        await _dongleHandler.SendRawAsync("$UNPAIR");
        await Task.Delay(500);
        _logger.LogInformation("Dongle unpair command sent");
    }

    #endregion

    #region Auto-Connect (Scanner-based)

    public HashSet<string> GetOccupiedPorts()
    {
        var ports = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (_scanner is not null)
        {
            var pendant = _scanner.Pendant;
            var dongle = _scanner.Dongle;
            if (pendant is not null) ports.Add(pendant.Port);
            if (dongle is not null) ports.Add(dongle.Port);
        }
        return ports;
    }

    public void StartAutoConnect()
    {
        var autoConnect = _settingsManager.GetSetting<bool>("pendant.autoConnect", true);
        if (!autoConnect) return;
        if (!_controller.IsConnected) return;
        if (_scanner is not null) return; // Already running

        _scanner = new PendantPortScanner(_logger, GetCncPort);
        _scanner.DeviceFound += OnScannerDeviceFound;
        _scanner.DeviceLost += OnScannerDeviceLost;
        _scanner.Start();
    }

    private string? GetCncPort()
    {
        // Only exclude the port if CNC is actually connected via serial
        if (_controller.Transport is Connection.SerialTransport serialTransport)
            return serialTransport.PortPath;
        return null;
    }

    // Internal for testing — called by scanner events and tests
    internal void HandleDeviceFound(PendantPortScanner.TrackedDevice device) => OnScannerDeviceFound(device);
    internal void HandleDeviceLost(PendantPortScanner.TrackedDevice device) => OnScannerDeviceLost(device);

    private void OnScannerDeviceFound(PendantPortScanner.TrackedDevice device)
    {
        _logger.LogInformation("Scanner found {Type} on {Port}", device.Type, device.Port);

        switch (device.Type)
        {
            case PendantPortScanner.DeviceType.Pendant:
                _pendantUsbHandler = device.Handler;
                // Use pendant USB if dongle isn't connected or hasn't established
                // communication with the pendant (e.g., dongle plugged in but not paired)
                if (_dongleHandler is null || !_dongleHandler.IsConnected || !_pendantConnected)
                {
                    _logger.LogInformation("Setting pendant USB as active data handler");
                    SetActiveHandler(_pendantUsbHandler);
                    // If dongle exists, watch for pings through it — a ping proves it's paired
                    // and we should promote it to active (ESP-NOW priority)
                    AttachDonglePromotionListener();
                }
                else
                {
                    _logger.LogInformation("Pendant USB connected (dongle is active, USB available for OTA)");
                }
                break;

            case PendantPortScanner.DeviceType.Dongle:
                _dongleHandler = device.Handler;
                // Dongle always takes priority — switch active handler
                _logger.LogInformation("Setting dongle as active data handler (ESP-NOW priority)");
                DetachDonglePromotionListener();
                SetActiveHandler(_dongleHandler);
                break;
        }

        _ = _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
    }

    private void OnScannerDeviceLost(PendantPortScanner.TrackedDevice device)
    {
        _logger.LogInformation("Scanner lost {Type} on {Port}", device.Type, device.Port);

        switch (device.Type)
        {
            case PendantPortScanner.DeviceType.Pendant:
                _pendantUsbHandler = null;
                // If pendant USB was active (or already disconnected), try dongle fallback
                if (_serialHandler == device.Handler || _serialHandler is null)
                {
                    DetachActiveHandler();
                    _pendantConnected = false;

                    if (_dongleHandler is { IsConnected: true })
                    {
                        _logger.LogInformation("Pendant USB lost, falling back to dongle");
                        SetActiveHandler(_dongleHandler);
                    }
                    else
                    {
                        _serialHandler = null;
                        _ = BroadcastDisconnect();
                    }
                }
                break;

            case PendantPortScanner.DeviceType.Dongle:
                DetachDonglePromotionListener();
                _dongleHandler = null;
                // If dongle was active (or already disconnected), try pendant USB fallback
                if (_serialHandler == device.Handler || _serialHandler is null)
                {
                    DetachActiveHandler();
                    _pendantConnected = false;

                    if (_pendantUsbHandler is { IsConnected: true })
                    {
                        _logger.LogInformation("Dongle lost, falling back to pendant USB");
                        SetActiveHandler(_pendantUsbHandler);
                    }
                    else
                    {
                        _serialHandler = null;
                        _ = BroadcastDisconnect();
                    }
                }
                break;
        }

        _ = _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
    }

    /// <summary>
    /// Sets a handler as the active data handler — wires up message events and starts keep-alive.
    /// Detaches the previous handler's events first (without closing its port).
    /// </summary>
    private void SetActiveHandler(PendantSerialHandler handler)
    {
        if (_serialHandler == handler) return;

        // Detach old handler events (don't close — scanner owns the port lifecycle)
        DetachActiveHandler();

        _serialHandler = handler;
        _serialHandler.RawMessageReceived += OnRawMessage;
        _serialHandler.MessageReceived += OnJsonMessage;
        _serialHandler.PortDisconnected += OnPortDisconnected;

        StartKeepAliveTimer();
    }

    /// <summary>
    /// Detaches event handlers from the current active handler without closing the port.
    /// </summary>
    private void DetachActiveHandler()
    {
        if (_serialHandler is null) return;
        _serialHandler.RawMessageReceived -= OnRawMessage;
        _serialHandler.MessageReceived -= OnJsonMessage;
        _serialHandler.PortDisconnected -= OnPortDisconnected;
        StopKeepAliveTimer();
    }

    /// <summary>
    /// Attaches a lightweight listener on the dongle that watches for ping messages.
    /// If the pendant pings through the dongle, it proves ESP-NOW is working (dongle is paired)
    /// and we promote the dongle to the active handler.
    /// </summary>
    private void AttachDonglePromotionListener()
    {
        DetachDonglePromotionListener();
        if (_dongleHandler is not { IsConnected: true }) return;

        _donglePromotionListener = line =>
        {
            if (line != "P") return; // Only promote on ping
            _logger.LogInformation("Pendant ping received through dongle — promoting to active (ESP-NOW paired)");
            DetachDonglePromotionListener();
            SetActiveHandler(_dongleHandler!);
            _ = _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
        };
        _dongleHandler.RawMessageReceived += _donglePromotionListener;
    }

    private void DetachDonglePromotionListener()
    {
        if (_donglePromotionListener is null || _dongleHandler is null) return;
        _dongleHandler.RawMessageReceived -= _donglePromotionListener;
        _donglePromotionListener = null;
    }

    private async Task BroadcastDisconnect()
    {
        await _broadcaster.Broadcast("client:disconnected", _clientMeta, NcSenderJsonContext.Default.PendantClientMeta);
        ResetClientMeta();
    }

    /// <summary>
    /// V1 VID/PID fallback: ESP32-S3 native USB CDC (303a:1001) = "ncsender", USB-serial bridges = "pibot".
    /// </summary>
    /// <summary>Returns true if latest is a higher semver than current.</summary>
    private static bool IsNewerVersion(string latest, string current)
    {
        if (string.IsNullOrEmpty(latest) || string.IsNullOrEmpty(current))
            return false;
        var lParts = latest.Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
        var cParts = current.Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
        for (var i = 0; i < Math.Max(lParts.Length, cParts.Length); i++)
        {
            var l = i < lParts.Length ? lParts[i] : 0;
            var c = i < cParts.Length ? cParts[i] : 0;
            if (l > c) return true;
            if (l < c) return false;
        }
        return false;
    }

    private static string? InferModelFromPort(string? portName)
    {
        if (string.IsNullOrEmpty(portName)) return null;
        if (portName.Contains("usbmodem", StringComparison.OrdinalIgnoreCase) ||
            portName.Contains("ttyACM", StringComparison.OrdinalIgnoreCase))
            return "ncsender";
        if (portName.Contains("usbserial", StringComparison.OrdinalIgnoreCase) ||
            portName.Contains("ttyUSB", StringComparison.OrdinalIgnoreCase) ||
            portName.Contains("SLAB_USBtoUART", StringComparison.Ordinal) ||
            portName.Contains("wchusbserial", StringComparison.OrdinalIgnoreCase))
            return "pibot";
        return null;
    }

    #endregion

    #region Keep-Alive Timer

    private void StartKeepAliveTimer()
    {
        StopKeepAliveTimer();
        _lastPongTicks = Environment.TickCount64;

        _keepAliveTimer = new Timer(_ =>
        {
            if (_pendantConnected && Environment.TickCount64 - _lastPongTicks > PingTimeoutMs)
            {
                // Don't close the serial port — dongle stays connected even when pendant is off.
                // Just mark as disconnected. When pendant reboots and pings again,
                // HandlePingAsync() will re-establish the connection through the same port.
                _pendantConnected = false;
                _ = _broadcaster.Broadcast("client:disconnected", _clientMeta, NcSenderJsonContext.Default.PendantClientMeta);
                ResetClientMeta();
            }

            // Always send DRO if port is open — pendant treats DRO as connection proof
            if (_serialHandler?.IsConnected == true)
            {
                _ = SendDroAsync(full: false);

                // Retry request:metadata until pendant responds — first attempt may be
                // dropped by dongle due to back-to-back ESP-NOW sends
                if (_pendantConnected && _clientMeta.Version is null)
                {
                    _ = Task.Run(async () =>
                    {
                        await Task.Delay(50); // Avoid back-to-back with DRO
                        if (_serialHandler?.IsConnected == true)
                            await _serialHandler.SendMessageAsync(
                                new PendantTypeMsg("request:metadata"),
                                PendantJsonContext.Default.PendantTypeMsg);
                    });
                }
            }
        }, null, PingIntervalMs, PingIntervalMs);
    }

    private void StopKeepAliveTimer()
    {
        _keepAliveTimer?.Dispose();
        _keepAliveTimer = null;
    }

    #endregion

    #region Message Dispatch — Raw Messages

    private void OnRawMessage(string data)
    {
        try
        {
            // Intercept $OTA responses during firmware flashing
            if (_otaResponseHandler is not null && data.StartsWith("$OTA:"))
            {
                _otaResponseHandler(data);
                return;
            }

            // Log non-OTA messages during OTA for diagnostics
            if (_otaInProgress)
            {
                _logger.LogDebug("Non-OTA raw message during flash: {Data}", data);
            }

            // Compact ping
            if (data == "P")
            {
                _ = HandlePingAsync();
                return;
            }

            // Full DRO request (like grblHAL's 0x87)
            if (data == "F")
            {
                _ = SendDroAsync(full: true);
                return;
            }

            // Compact jog: JX1.000F3000
            if (data.StartsWith('J') && data.Length > 1)
            {
                var axis = char.ToUpperInvariant(data[1]);
                if (axis is 'X' or 'Y' or 'Z' or 'A' or 'B' or 'C')
                {
                    _ = HandleCompactJogAsync(data[1..]);
                    return;
                }
            }

            // Compact command: C$H, C!, C~
            if (data.StartsWith('C') && data.Length > 1)
            {
                _ = HandleCompactCommandAsync(data[1..]);
                return;
            }

            // Compact job control: RS (start), RP (pause), RR (resume), RT (stop)
            if (data.StartsWith('R') && data.Length == 2)
            {
                var action = char.ToUpperInvariant(data[1]);
                switch (action)
                {
                    case 'S': _ = HandleJobStartAsync(); return;
                    case 'P': _ = HandleJobPauseAsync(); return;
                    case 'R': _ = HandleJobResumeAsync(); return;
                    case 'T': _ = HandleJobStopAsync(); return;
                }
            }

            // Bare G-code lines: G*, M*, $*
            if (data.Length > 1 && Regex.IsMatch(data, @"^[GM$]\d", RegexOptions.IgnoreCase))
            {
                _ = HandleCompactCommandAsync(data);
                return;
            }

            // $ID responses handled by scanner — ignore here
            if (data.StartsWith("$ID:"))
                return;

            // Log debug messages from pendant firmware (e.g., [ESPNOW] prefix)
            if (data.StartsWith('['))
            {
                _logger.LogInformation("Pendant: {Data}", data);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error handling raw pendant message: {Data}", data);
        }
    }

    #endregion

    #region Message Dispatch — JSON Messages

    private void OnJsonMessage(JsonElement root)
    {
        try
        {
            // Any message resets last pong time
            if (_pendantConnected)
                _lastPongTicks = Environment.TickCount64;

            if (!root.TryGetProperty("type", out var typeEl))
                return;

            var type = typeEl.GetString();

            switch (type)
            {
                case "ping":
                    _ = HandlePingAsync();
                    break;
                case "cnc:command":
                    if (root.TryGetProperty("data", out var cmdData))
                        _ = HandleCncCommandJsonAsync(cmdData);
                    break;
                case "job:start":
                    _ = HandleJobStartAsync();
                    break;
                case "job:pause":
                    _ = HandleJobPauseAsync();
                    break;
                case "job:resume":
                    _ = HandleJobResumeAsync();
                    break;
                case "job:stop":
                    _ = HandleJobStopAsync();
                    break;
                case "client:metadata":
                    HandleClientMetadata(root);
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error handling JSON pendant message");
        }
    }

    #endregion

    #region Port Disconnection

    private void OnPortDisconnected()
    {
        var wasConnected = _pendantConnected;
        _pendantConnected = false;

        if (wasConnected)
        {
            _logger.LogInformation("Active handler port disconnected");
            _ = BroadcastDisconnect();
        }
        else
        {
            ResetClientMeta();
        }

        // Detach events from the disconnected handler
        DetachActiveHandler();
        _serialHandler = null;

        // Scanner will detect the disappeared port and fire DeviceLost,
        // which handles fallback logic (dongle → USB or vice versa).
        // No need to manually reconnect — scanner continuously monitors.
        _ = _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
    }

    #endregion

    #region Ping / Handshake

    private async Task HandlePingAsync()
    {
        _lastPongTicks = Environment.TickCount64;

        if (!_pendantConnected)
        {
            // Initial handshake: send K pong, mark connected
            await _serialHandler!.SendRawAsync("K");
            _pendantConnected = true;
            _logger.LogInformation("Pendant handshake complete");
            await _broadcaster.Broadcast("client:connected", _clientMeta, NcSenderJsonContext.Default.PendantClientMeta);
            await _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);

            // Reset dedup state
            _lastSentSettings = null;
            _lastSentDro = null;

            // Send initial full DRO + settings after brief delay to avoid back-to-back ESP-NOW drops
            _serverContext.UpdateSenderStatus();
            await Task.Delay(100);

            if (_serialHandler?.IsConnected == true)
            {
                await SendDroAsync(full: true);
                SendSettings(force: true);

                // Request metadata (scanner already classified the port via $ID)
                await Task.Delay(300);
                await _serialHandler.SendMessageAsync(
                    new PendantTypeMsg("request:metadata"),
                    PendantJsonContext.Default.PendantTypeMsg);
            }
        }
        else
        {
            // Already connected — send delta DRO (no K, avoids back-to-back ESP-NOW drops)
            await SendDroAsync(full: false);
        }
    }

    private void ResetClientMeta()
    {
        _clientMeta = _clientMeta with { Version = null, DeviceId = null, Licensed = false };
    }

    private void HandleClientMetadata(JsonElement root)
    {
        if (!root.TryGetProperty("data", out var data))
            return;
        if (_serialHandler is null)
            return;

        // Update serial handler's device info from pendant metadata (V1: Object.assign(clientMeta, parsed.data))
        if (data.TryGetProperty("version", out var v))
            _serialHandler.DeviceVersion = v.GetString();
        if (data.TryGetProperty("deviceId", out var d))
            _serialHandler.DeviceId = d.GetString();
        // V1 also uses machineId as a fallback for deviceId
        if (string.IsNullOrEmpty(_serialHandler.DeviceId) && data.TryGetProperty("machineId", out var mid))
            _serialHandler.DeviceId = mid.GetString();
        if (data.TryGetProperty("deviceModel", out var m))
            _serialHandler.DeviceModel = m.GetString();
        if (data.TryGetProperty("licensed", out var l))
            _serialHandler.Licensed = l.ValueKind == JsonValueKind.True;

        // Update broadcast metadata to match V1's Object.assign(clientMeta, parsed.data)
        _clientMeta = _clientMeta with
        {
            Version = _serialHandler.DeviceVersion,
            DeviceId = _serialHandler.DeviceId,
            Licensed = _serialHandler.Licensed
        };

        var resetReason = data.TryGetProperty("resetReason", out var rr) ? rr.GetString() : null;
        var resetReasonCode = data.TryGetProperty("resetReasonCode", out var rrc) ? rrc.GetInt32().ToString() : "?";

        _logger.LogInformation("Pendant metadata received: version={Version}, deviceId={DeviceId}, licensed={Licensed}, resetReason={ResetReason} ({ResetReasonCode})",
            _serialHandler.DeviceVersion, _serialHandler.DeviceId, _serialHandler.Licensed, resetReason, resetReasonCode);

        // Broadcast updated status so UI picks up version/licensed
        _ = _broadcaster.Broadcast("pendant:status-changed", GetStatus(), NcSenderJsonContext.Default.PendantStatus);
    }

    #endregion

    #region Compact Jog

    private async Task HandleCompactJogAsync(string jogData)
    {
        // Format: X1.000F3000 or Y-0.100F1500 or X1.000F3000S (S=silent)
        var axis = char.ToUpperInvariant(jogData[0]);
        var rest = jogData[1..];

        var silent = rest.EndsWith('S') || rest.EndsWith('s');
        if (silent) rest = rest[..^1];

        var fIndex = rest.IndexOf('F', StringComparison.OrdinalIgnoreCase);
        if (fIndex == -1)
        {
            _logger.LogWarning("Invalid compact jog format (missing F): {Data}", jogData);
            return;
        }

        var distance = rest[..fIndex];
        var feedRate = rest[(fIndex + 1)..];

        if (string.IsNullOrEmpty(distance) || string.IsNullOrEmpty(feedRate))
        {
            _logger.LogWarning("Invalid compact jog format: {Data}", jogData);
            return;
        }

        var jogCommand = $"$J=G21 G91 {axis}{distance} F{feedRate}";

        await _controller.SendCommandAsync(jogCommand, new CommandOptions
        {
            Meta = new CommandMeta
            {
                SourceId = "usb-pendant",
                SkipJogCancel = true,
                Silent = silent
            }
        });
    }

    #endregion

    #region Compact Command

    private async Task HandleCompactCommandAsync(string command)
    {
        // Translate \xHH hex notation to single char
        var cmd = command;
        var hexMatch = Regex.Match(command, @"^\\x([0-9a-fA-F]{2})$", RegexOptions.IgnoreCase);
        if (hexMatch.Success)
        {
            var b = byte.Parse(hexMatch.Groups[1].Value, NumberStyles.HexNumber);
            cmd = ((char)b).ToString();
        }

        await HandleCncCommandCoreAsync(cmd);
    }

    #endregion

    #region CNC Command Processing

    private async Task HandleCncCommandJsonAsync(JsonElement data)
    {
        string? command = null;
        if (data.TryGetProperty("command", out var cmdEl))
            command = cmdEl.GetString();

        if (string.IsNullOrEmpty(command)) return;

        // Translate hex notation
        var hexMatch = Regex.Match(command, @"^(?:\\x|0x)([0-9a-fA-F]{2})$", RegexOptions.IgnoreCase);
        if (hexMatch.Success)
        {
            var b = byte.Parse(hexMatch.Groups[1].Value, NumberStyles.HexNumber);
            command = ((char)b).ToString();
        }

        await HandleCncCommandCoreAsync(command);
    }

    private async Task HandleCncCommandCoreAsync(string command)
    {
        try
        {
            var processorContext = new CommandProcessorContext
            {
                MachineState = _serverContext.State.MachineState,
                Meta = new CommandMeta { SourceId = "usb-pendant" }
            };

            var result = await _commandProcessor.ProcessAsync(command, processorContext);
            if (!result.ShouldContinue) return;

            foreach (var cmd in result.Commands)
            {
                await _controller.SendCommandAsync(cmd.Command, new CommandOptions
                {
                    DisplayCommand = cmd.DisplayCommand ?? cmd.Command,
                    Meta = cmd.Meta ?? new CommandMeta { SourceId = "usb-pendant" }
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Pendant command failed: {Command}", command);
        }
    }

    #endregion

    #region Job Control

    private async Task HandleJobStartAsync()
    {
        try
        {
            var state = _serverContext.State;
            var filename = state.JobLoaded?.Filename;
            if (string.IsNullOrEmpty(filename))
            {
                _logger.LogDebug("Pendant job:start: No program loaded");
                return;
            }

            if (!state.MachineState.Connected)
            {
                _logger.LogDebug("Pendant job:start: CNC not connected");
                return;
            }

            var status = state.MachineState.Status?.ToLowerInvariant();
            if (status != "idle")
            {
                _logger.LogDebug("Pendant job:start: Machine state is {Status}", status);
                return;
            }

            await _jobManager.StartJobAsync();
            _logger.LogInformation("Job started via USB pendant");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Pendant job:start failed");
        }
    }

    private async Task HandleJobPauseAsync()
    {
        try
        {
            var status = _serverContext.State.MachineState.Status?.ToLowerInvariant();
            if (status is "hold" or "door") return;
            if (status != "run")
            {
                _logger.LogDebug("Pendant job:pause: Machine state is {Status}", status);
                return;
            }

            var useDoorAsPause = _settingsManager.GetSetting<bool>("useDoorAsPause", false);
            var command = useDoorAsPause ? "\x84" : "!";

            await _controller.SendCommandAsync(command, new CommandOptions
            {
                DisplayCommand = useDoorAsPause ? "\\x84 (Safety Door)" : "! (Feed Hold)",
                Meta = new CommandMeta { SourceId = "usb-pendant", Silent = true }
            });

            _jobManager.Pause();
            _logger.LogInformation("Job paused via USB pendant");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Pendant job:pause failed");
        }
    }

    private async Task HandleJobResumeAsync()
    {
        try
        {
            var status = _serverContext.State.MachineState.Status?.ToLowerInvariant();
            if (status is not ("hold" or "door"))
            {
                _logger.LogDebug("Pendant job:resume: Machine state is {Status}", status);
                return;
            }

            await _controller.SendCommandAsync("~", new CommandOptions
            {
                DisplayCommand = "~ (Resume)",
                Meta = new CommandMeta { SourceId = "usb-pendant", Silent = true }
            });

            _jobManager.Resume();
            _logger.LogInformation("Job resumed via USB pendant");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Pendant job:resume failed");
        }
    }

    private async Task HandleJobStopAsync()
    {
        try
        {
            if (!_jobManager.HasActiveJob)
            {
                _logger.LogDebug("Pendant job:stop: No active job");
                return;
            }

            var pauseBeforeStop = _settingsManager.GetSetting<int>("pauseBeforeStop", 500);

            await _controller.SendCommandAsync("!", new CommandOptions
            {
                DisplayCommand = "! (Feed Hold)",
                Meta = new CommandMeta { SourceId = "usb-pendant", Silent = true }
            });

            if (pauseBeforeStop > 0)
                await Task.Delay(pauseBeforeStop);

            await _controller.SendCommandAsync("\x18", new CommandOptions
            {
                DisplayCommand = "\\x18 (Soft Reset)",
                Meta = new CommandMeta { SourceId = "usb-pendant", Silent = true }
            });

            _jobManager.Stop();
            _logger.LogInformation("Job stopped via USB pendant");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Pendant job:stop failed");
        }
    }

    #endregion

    #region Full/Delta DRO Broadcasting

    private async Task SendDroAsync(bool full)
    {
        if (_serialHandler is not { IsConnected: true } || _otaInProgress) return;

        var state = _serverContext.State;
        var ms = state.MachineState;

        // Build current snapshot
        var wpos = ComputeWorkPosition(ms);
        var overrides = $"{ms.FeedrateOverride:F0},{ms.RapidOverride:F0},{ms.SpindleOverride:F0}";
        var feedRate = Math.Round(ms.FeedRate);
        var spindleRpm = Math.Round(ms.SpindleRpmActual);
        var connected = ms.Connected;
        var homed = ms.Homed;
        var alarmCode = ms.AlarmCode.HasValue && ms.Status == "Alarm" ? ms.AlarmCode : null;
        var job = state.JobLoaded;
        var jobProgress = job is { Status: "running", TotalLines: > 0 } ? $"{job.CurrentLine}/{job.TotalLines}" : null;
        var jobStatus = job?.Status;
        var wco = ms.WCO ?? "0,0,0";
        var workspace = ms.Workspace ?? "G54";
        var maxFeedX = ms.MaxFeedrateX;
        var maxFeedY = ms.MaxFeedrateY;
        var maxFeedZ = ms.MaxFeedrateZ;

        var current = new PendantDroSnapshot(
            Status: ms.Status ?? "Unknown",
            WPos: wpos,
            Overrides: overrides,
            FeedRate: feedRate,
            SpindleRpm: spindleRpm,
            Connected: connected,
            Homed: homed,
            AlarmCode: alarmCode,
            JobProgress: jobProgress,
            JobStatus: jobStatus,
            WCO: wco,
            Workspace: workspace,
            MaxFeedX: maxFeedX,
            MaxFeedY: maxFeedY,
            MaxFeedZ: maxFeedZ
        );

        var prev = _lastSentDro;
        var isFull = full || prev is null;

        var sb = new StringBuilder(180);
        sb.Append(isFull ? "$!" : "$");

        // Status — always included (heartbeat)
        sb.Append(current.Status);

        if (isFull || current.WPos != prev!.WPos)
            sb.Append($"|P:{current.WPos}");

        if (isFull || current.Overrides != prev!.Overrides)
            sb.Append($"|O:{current.Overrides}");

        if (isFull || current.FeedRate != prev!.FeedRate)
        {
            if (isFull || current.FeedRate > 0)
                sb.Append($"|F:{current.FeedRate}");
        }

        if (isFull || current.SpindleRpm != prev!.SpindleRpm)
        {
            if (isFull || current.SpindleRpm > 0)
                sb.Append($"|R:{current.SpindleRpm}");
        }

        // Connected/Homed — always send in full; in delta always send (sticky flags need reset signal)
        if (current.Connected)
            sb.Append("|C");
        if (current.Homed)
            sb.Append("|H");

        if (isFull || current.AlarmCode != prev!.AlarmCode)
        {
            if (current.AlarmCode.HasValue)
                sb.Append($"|A:{current.AlarmCode}");
        }

        if (isFull || current.JobProgress != prev!.JobProgress)
        {
            if (current.JobProgress is not null)
                sb.Append($"|J:{current.JobProgress}");
        }

        if (isFull || current.JobStatus != prev!.JobStatus)
        {
            if (current.JobStatus is not null)
                sb.Append($"|D:{current.JobStatus}");
        }

        // WCO — always send (ESP-NOW unreliable)
        sb.Append($"|W:{current.WCO}");

        // Workspace (G54/G55/etc.)
        if (isFull || current.Workspace != prev!.Workspace)
            sb.Append($"|G:{current.Workspace}");

        // Per-axis max feedrate
        if (isFull || current.MaxFeedX != prev!.MaxFeedX || current.MaxFeedY != prev!.MaxFeedY || current.MaxFeedZ != prev!.MaxFeedZ)
            sb.Append($"|M:{current.MaxFeedX:F0},{current.MaxFeedY:F0},{current.MaxFeedZ:F0}");

        _lastSentDro = current;
        await _serialHandler.SendRawAsync(sb.ToString());
    }

    private static string ComputeWorkPosition(MachineState ms)
    {
        var mposParts = (ms.MPos ?? "0,0,0").Split(',');
        var wcoParts = (ms.WCO ?? "0,0,0").Split(',');
        var sb = new StringBuilder(40);
        for (var i = 0; i < mposParts.Length; i++)
        {
            if (i > 0) sb.Append(',');
            var mVal = double.TryParse(mposParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var m) ? m : 0;
            var wVal = i < wcoParts.Length && double.TryParse(wcoParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var w) ? w : 0;
            sb.Append((mVal - wVal).ToString("F3", CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }

    private record PendantDroSnapshot(
        string Status,
        string WPos,
        string Overrides,
        double FeedRate,
        double SpindleRpm,
        bool Connected,
        bool Homed,
        int? AlarmCode,
        string? JobProgress,
        string? JobStatus,
        string WCO,
        string Workspace,
        double MaxFeedX,
        double MaxFeedY,
        double MaxFeedZ
    );

    #endregion

    #region Settings Sync

    public void NotifySettingsChanged()
    {
        SendSettings(force: true);
    }

    private void SendSettings(bool force = false)
    {
        if (_serialHandler is not { IsConnected: true } || !_pendantConnected)
            return;

        var theme = _settingsManager.GetSetting<string>("theme") ?? "dark";
        var snapshot = new PendantSettingsSnapshot(
            Theme: theme,
            AccentColor: _settingsManager.GetSetting<string>("accentColor") ?? _settingsManager.GetSetting<string>("primaryColor"),
            GradientColor: _settingsManager.GetSetting<string>("gradientColor"),
            DarkMode: string.Equals(theme, "dark", StringComparison.OrdinalIgnoreCase)
        );

        if (!force && _lastSentSettings is not null && snapshot == _lastSentSettings)
            return;

        _lastSentSettings = snapshot;

        var msg = new PendantSettingsMsg("settings-changed", new PendantSettingsData(
            snapshot.Theme,
            snapshot.AccentColor,
            snapshot.GradientColor,
            snapshot.DarkMode
        ));

        _ = _serialHandler.SendMessageAsync(msg, PendantJsonContext.Default.PendantSettingsMsg);
    }

    private record PendantSettingsSnapshot(
        string? Theme,
        string? AccentColor,
        string? GradientColor,
        bool DarkMode
    );

    #endregion
}
