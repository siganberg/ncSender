using System.Globalization;
using System.Security.Cryptography;
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
    private readonly IDongleDeviceService _dongleDevices;   // shares the dongle; fed "@name" addressed-device lines
    private readonly NcSender.Server.Dongle.DongleOtaService _dongleOta;   // wireless firmware push via the dongle
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
    // Held so OtaCleanup can detach the subscription installed in FlashFileAsync.
    // Without this, each OTA attempt leaks a handler on the pendant USB port; on
    // the Nth attempt every $OTA:ACK fires N handlers, calling SendNextChunk N
    // times per ack and overrunning the pendant UART mid-flash.
    private Action<string>? _otaHandlerSubscription;
    private PendantSerialHandler? _otaSubscribedHandler;
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
    // Every N keep-alive ticks send a full-frame ($!) DRO instead of a delta ($),
    // so any missed delta on the lossy broadcast path self-corrects. 5s cadence
    // is small enough to keep MPos accurate and large enough to be free airtime.
    private const int FullDroEveryNTicks = 5;
    private long _droFrameCounter;
    private const int PingTimeoutMs = 3000;

    private readonly IGateService _gates;
    private readonly INcSenderUsbCatalog _usbCatalog;

    public PendantManager(
        ILogger<PendantManager> logger,
        ICncController controller,
        IBroadcaster broadcaster,
        IServerContext serverContext,
        IJobManager jobManager,
        ICommandProcessor commandProcessor,
        ISettingsManager settingsManager,
        IDongleDeviceService dongleDevices,
        NcSender.Server.Dongle.DongleOtaService dongleOta,
        IGateService gates,
        INcSenderUsbCatalog usbCatalog)
    {
        _logger = logger;
        _controller = controller;
        _broadcaster = broadcaster;
        _serverContext = serverContext;
        _jobManager = jobManager;
        _commandProcessor = commandProcessor;
        _settingsManager = settingsManager;
        _dongleDevices = dongleDevices;
        _dongleOta = dongleOta;
        _gates = gates;
        _usbCatalog = usbCatalog;

        // Mirror gate lifecycle to the pendant. Gate events broadcast on the
        // browser channel also need to reach the pendant so it can render the
        // same prompt and respond. Filters by type so we don't ship every
        // broadcast down the serial pipe.
        _broadcaster.MessageBroadcast += OnBroadcastToPendant;

        // Give the dongle device service a path to send "@name" commands out over the
        // dongle (read at call-time, so it follows dongle connect/disconnect).
        _dongleDevices.SetSender(line =>
        {
            // Snapshot the field: it is cleared from another thread when the
            // dongle drops, so testing and dereferencing it separately can NPE.
            var h = _dongleHandler;
            return h is not null ? h.SendRawAsync(line) : Task.CompletedTask;
        });

        // Subscribe to status reports for DRO broadcasting
        _controller.StatusReportReceived += OnStatusReportReceived;

        // Start pendant auto-connect once CNC controller is connected
        _controller.ConnectionStatusChanged += (status, isConnected) =>
        {
            if (isConnected)
                StartAutoConnect();
            else
                StopAutoConnect();
        };
    }

    private void OnStatusReportReceived(MachineState state)
    {
        // Push a delta DRO on every status change whenever the dongle is up.
        // Not gated on `_pendantConnected`: the dongle broadcasts DRO to every
        // paired peer (v0.3.2+), so accessories like the RGB strip ride this
        // same stream. Requiring the pendant to be online used to strand the
        // accessories on the 1 s keep-alive cadence and show up as ~500 ms
        // lag on state changes when the pendant was offline.
        if (_serialHandler?.IsConnected == true && !_otaInProgress)
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
            OtaReady = otaReady,
            DongleConnected = _dongleHandler is { IsConnected: true }
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

    private const string DongleProduct = "ncsender-wireless-usb";

    public async Task<DongleLicenseStatus> GetDongleLicenseAsync()
    {
        if (_dongleHandler is not { IsConnected: true })
            return new DongleLicenseStatus(Connected: false, Licensed: false, DeviceId: "");

        // "$LICENSE" -> "$LICENSE:<0|1> <deviceId> ncsender-wireless-usb"
        var reply = await QueryDongleAsync("$LICENSE",
            line => line.StartsWith("$LICENSE:", StringComparison.Ordinal), timeoutMs: 2000);
        var parts = reply["$LICENSE:".Length..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2 && (parts[0] == "0" || parts[0] == "1"))
            return new DongleLicenseStatus(Connected: true, Licensed: parts[0] == "1", DeviceId: parts[1]);
        throw new InvalidOperationException("Unexpected $LICENSE reply from dongle");
    }

    public async Task<string?> GetDongleVersionAsync()
    {
        if (_dongleHandler is not { IsConnected: true }) return null;
        try
        {
            var reply = await QueryDongleAsync("$VERSION",
                line => line.StartsWith("$VERSION:", StringComparison.Ordinal), timeoutMs: 2000);
            return reply["$VERSION:".Length..].Trim();
        }
        catch
        {
            // Firmware predating $VERSION just says nothing. That is not an
            // error worth surfacing — the caller shows "unknown" and moves on.
            return null;
        }
    }

    public async Task ActivateDongleAsync(string installationId)
    {
        var status = await GetDongleLicenseAsync();
        if (!status.Connected)
            throw new InvalidOperationException("Wireless USB not connected");
        if (string.IsNullOrEmpty(status.DeviceId))
            throw new InvalidOperationException("Wireless USB device ID not available. Please reconnect it.");

        _logger.LogInformation("Calling activation server for Wireless USB dongle");
        using var http = new HttpClient();
        var activationResponse = await http.PostAsync(ActivationApiUrl,
            new StringContent(
                $$$"""{"installationId":"{{{installationId}}}","machineHash":"{{{status.DeviceId}}}","product":"{{{DongleProduct}}}"}""",
                System.Text.Encoding.UTF8, "application/json")
            { Headers = { { "X-Api-Key", ActivationApiKey } } });

        var activationText = await activationResponse.Content.ReadAsStringAsync();
        if (!activationResponse.IsSuccessStatusCode)
        {
            var error = "Activation failed";
            try { var doc = System.Text.Json.JsonDocument.Parse(activationText); error = doc.RootElement.GetProperty("error").GetString() ?? error; } catch { }
            throw new InvalidOperationException(error);
        }

        // Push the signed license to the dongle. The dongle protocol is line-delimited,
        // so the license JSON must be a single compact line: "$LICENSE <json>".
        var compact = CompactJson(activationText);
        var reply = await QueryDongleAsync($"$LICENSE {compact}",
            line => line == "$LICENSE:OK" || line.StartsWith("$LICENSE:ERR", StringComparison.Ordinal),
            timeoutMs: 4000);
        if (reply != "$LICENSE:OK")
        {
            var msg = reply.StartsWith("$LICENSE:ERR", StringComparison.Ordinal)
                ? reply["$LICENSE:ERR".Length..].Trim()
                : reply;
            throw new InvalidOperationException($"Wireless USB rejected license: {msg}");
        }

        _logger.LogInformation("Wireless USB dongle license activated");
    }

    /// <summary>
    /// Sends a raw line to the dongle and awaits the first reply line matching <paramref name="match"/>.
    /// Attaches a temporary listener directly to the dongle handler (works whether or not the
    /// dongle is the active data handler).
    /// </summary>
    private async Task<string> QueryDongleAsync(string command, Func<string, bool> match, int timeoutMs)
    {
        // Bind the handler ONCE. _dongleHandler is cleared from OnPortDisconnected
        // on another thread when the dongle drops, so re-reading the field here
        // meant a dongle that vanished mid-query threw NullReferenceException out
        // of the finally — masking the real TimeoutException with a bogus one.
        // Unsubscribing from the same object we subscribed to is also simply
        // correct, whatever the field points at by the time we unwind.
        var handler = _dongleHandler;
        if (handler is not { IsConnected: true })
            throw new InvalidOperationException("Wireless USB not connected");

        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnLine(string line) { if (match(line)) tcs.TrySetResult(line); }

        handler.RawMessageReceived += OnLine;
        try
        {
            await handler.SendRawAsync(command);
            var done = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs));
            if (done != tcs.Task)
                throw new TimeoutException("Wireless USB did not respond");
            return await tcs.Task;
        }
        finally
        {
            handler.RawMessageReceived -= OnLine;
        }
    }

    /// <summary>Re-serialize a JSON string to a single compact line (AOT-safe, no context needed).</summary>
    private static string CompactJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
            doc.RootElement.WriteTo(w);
        return System.Text.Encoding.UTF8.GetString(ms.ToArray());
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
        // Direct USB is always preferred (fastest + simplest). If it's not
        // available, fall through to wireless via the dongle. A pendant paired
        // to the dongle registers as "pendant" in the dongle device table once
        // it sends anything tagged (OTA_ACKs are tagged, so it registers as
        // soon as the first BEGIN goes out).
        var isDongleActive = _dongleHandler is not null && _serialHandler == _dongleHandler;
        var haveDirectUsb = _pendantUsbHandler is { IsConnected: true };
        var haveDongle    = _dongleHandler is { IsConnected: true };

        if (!haveDirectUsb && haveDongle)
        {
            using var wms = new MemoryStream();
            await firmware.CopyToAsync(wms);
            var bytes = wms.ToArray();
            _logger.LogInformation("OTA: wireless firmware push over dongle ({Size} bytes)", bytes.Length);
            _otaInProgress = true;
            try
            {
                await _dongleOta.FlashAsync(
                    deviceName: "pendant",
                    firmware: bytes,
                    deviceId: "pendant",
                    ct: CancellationToken.None,
                    onProgress: pct =>
                    {
                        if (onProgress is null) return;
                        _ = onProgress((double)pct);
                    });
            }
            finally
            {
                _otaInProgress = false;
            }
            return;
        }

        if (_serialHandler is not { IsConnected: true })
            throw new InvalidOperationException("Pendant not connected via USB");

        // OTA always goes through direct USB to pendant.
        // If active handler is dongle, use the pendant USB handler instead.
        PendantSerialHandler? otaHandler = null;
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

        const int chunkSize = 4096;
        const int chunkAckTimeoutMs = 2500;   // per-chunk ACK wait before resend
        const int chunkMaxRetries = 4;        // fail hard past this
        var offset = 0;

        // V2 protocol state (populated when pendant reports READY:V2).
        var useV2 = false;
        var currentSeq = 0;
        var currentChunkOffset = 0;
        var currentChunkLen = 0;
        var currentRetries = 0;
        Timer? chunkAckTimer = null;

        void ResetTimeout()
        {
            try { inactivityTimer.Change(30000, Timeout.Infinite); } catch { /* disposed */ }
        }

        void CancelChunkAckTimer()
        {
            try { chunkAckTimer?.Change(Timeout.Infinite, Timeout.Infinite); } catch { /* disposed */ }
        }

        void ArmChunkAckTimer()
        {
            try { chunkAckTimer?.Change(chunkAckTimeoutMs, Timeout.Infinite); } catch { /* disposed */ }
        }

        // V1 (legacy raw-stream) chunk sender — sends up to chunkSize bytes and
        // waits for a plain "$OTA:ACK" line.
        void SendNextChunkV1()
        {
            if (offset >= data.Length) return;
            var end = Math.Min(offset + chunkSize, data.Length);
            handler.WriteRawBytes(data, offset, end - offset);
            offset = end;
        }

        // V2 chunk sender — writes a header line + raw body, then arms the
        // per-chunk ACK timer. Retries live in currentRetries so a resend from
        // NAK or timeout uses identical bytes without re-computing offsets.
        void SendChunkV2(bool isRetry)
        {
            if (currentChunkOffset >= data.Length) return;
            if (!isRetry)
            {
                currentChunkLen = Math.Min(chunkSize, data.Length - currentChunkOffset);
                currentRetries = 0;
            }
            var crc = Crc32(data, currentChunkOffset, currentChunkLen);
            var header = $"$C:{currentSeq}:{currentChunkLen}:{crc:x8}\n";
            var headerBytes = Encoding.ASCII.GetBytes(header);
            handler.WriteRawBytes(headerBytes, 0, headerBytes.Length);
            handler.WriteRawBytes(data, currentChunkOffset, currentChunkLen);
            ArmChunkAckTimer();
        }

        void RetryChunkV2(string reason)
        {
            CancelChunkAckTimer();
            currentRetries++;
            if (currentRetries > chunkMaxRetries)
            {
                var msg = $"Chunk {currentSeq} {reason} after {chunkMaxRetries} retries";
                _logger.LogError("OTA: {Msg}", msg);
                OtaCleanup();
                inactivityTimer.Dispose();
                StartKeepAliveTimer();
                progressSignal.Release();
                tcs.TrySetException(new InvalidOperationException(msg));
                return;
            }
            _logger.LogWarning("OTA: chunk {Seq} {Reason} — retry {N}/{Max}", currentSeq, reason, currentRetries, chunkMaxRetries);
            SendChunkV2(isRetry: true);
        }

        // Fires when the pendant hasn't ACKed the outstanding chunk in time
        // (bytes probably dropped on the Pi's USB CDC OUT queue). Resend same
        // seq — pendant dedups if it already wrote it.
        chunkAckTimer = new Timer(_ =>
        {
            if (!useV2) return;
            RetryChunkV2("timeout");
        }, null, Timeout.Infinite, Timeout.Infinite);

        _otaResponseHandler = (line) =>
        {
            try
            {
                _logger.LogDebug("OTA response: {Line}", line);

                if (line == "$OTA:READY:V2")
                {
                    _logger.LogInformation("OTA: pendant ready (V2), sending first chunk");
                    useV2 = true;
                    ResetTimeout();
                    currentChunkOffset = offset;
                    currentSeq = 0;
                    SendChunkV2(isRetry: false);
                }
                else if (line == "$OTA:READY")
                {
                    _logger.LogInformation("OTA: pendant ready (V1 legacy), sending first chunk");
                    useV2 = false;
                    ResetTimeout();
                    SendNextChunkV1();
                }
                else if (line == "$OTA:ACK")
                {
                    // V1 legacy — pendant ACK'd a raw-stream chunk.
                    ResetTimeout();
                    SendNextChunkV1();
                }
                else if (useV2 && line.StartsWith("$A:"))
                {
                    // $A:<seq> — chunk seq accepted by pendant.
                    if (int.TryParse(line.AsSpan(3), out var ackedSeq) && ackedSeq == currentSeq)
                    {
                        CancelChunkAckTimer();
                        ResetTimeout();
                        offset = currentChunkOffset + currentChunkLen;
                        currentChunkOffset = offset;
                        currentSeq++;
                        if (currentChunkOffset < data.Length)
                            SendChunkV2(isRetry: false);
                    }
                    // Stale ACK for an earlier seq (we already advanced past it) — ignore.
                }
                else if (useV2 && line.StartsWith("$N:"))
                {
                    // $N:<seq>:<reason> — pendant rejected the current chunk (CRC/LEN/SEQ).
                    // Resend same seq.
                    ResetTimeout();
                    var colon = line.IndexOf(':', 3);
                    var reason = colon > 0 ? line[(colon + 1)..] : "nak";
                    RetryChunkV2(reason);
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
                    CancelChunkAckTimer();
                    chunkAckTimer?.Dispose();
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
                    CancelChunkAckTimer();
                    chunkAckTimer?.Dispose();
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
                CancelChunkAckTimer();
                chunkAckTimer?.Dispose();
                OtaCleanup();
                inactivityTimer.Dispose();
                StartKeepAliveTimer();
                progressSignal.Release();
                tcs.TrySetException(ex);
            }
        };

        // If using dedicated OTA handler, listen for responses on it instead of main handler.
        // Hold the delegate so OtaCleanup can detach it — otherwise every attempt leaks a
        // subscription and doubles the chunks sent per ACK on the next flash.
        // Filter accepts $OTA:, $A:, $N: (V2 ACK/NAK prefixes).
        if (otaHandler is not null)
        {
            Action<string> sub = (line) =>
            {
                if (line.StartsWith("$OTA:") || line.StartsWith("$A:") || line.StartsWith("$N:"))
                    _otaResponseHandler?.Invoke(line);
            };
            _otaHandlerSubscription = sub;
            _otaSubscribedHandler = otaHandler;
            otaHandler.RawMessageReceived += sub;
        }

        // Send OTA init command using raw protocol (not JSON).
        // Include the firmware MD5 so the pendant can call Update.setMD5() and
        // detect byte-level corruption at Update.end() with a specific error
        // ("MD5 Failed…") instead of the vague "End failed" that only means
        // "image header didn't validate." Older pendant firmware (pre-1.0.40)
        // stops parsing at the ':' and just ignores the extra field, so this
        // stays backward compatible.
        var md5Hex = Convert.ToHexString(MD5.HashData(data)).ToLowerInvariant();
        _logger.LogInformation("Sending OTA init: $OTA:{Size}:{Md5} ({Chunks} chunks)", data.Length, md5Hex, (data.Length + chunkSize - 1) / chunkSize);
        await handler.SendRawAsync($"$OTA:{data.Length}:{md5Hex}");

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
        if (_otaSubscribedHandler is not null && _otaHandlerSubscription is not null)
        {
            try { _otaSubscribedHandler.RawMessageReceived -= _otaHandlerSubscription; }
            catch { /* handler already gone */ }
        }
        _otaSubscribedHandler = null;
        _otaHandlerSubscription = null;
    }

    // Standard IEEE 802.3 CRC-32 (poly 0xEDB88320). Matches the pendant's
    // table so per-chunk verification agrees on both sides. Table built
    // once at first use; single-byte hot loop is fine for the ~1 MB
    // firmware payloads we push.
    private static readonly uint[] _crc32Table = BuildCrc32Table();

    private static uint[] BuildCrc32Table()
    {
        var t = new uint[256];
        for (uint i = 0; i < 256; i++)
        {
            uint c = i;
            for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (uint)-(int)(c & 1u));
            t[i] = c;
        }
        return t;
    }

    private static uint Crc32(byte[] data, int offset, int count)
    {
        uint crc = 0xFFFFFFFFu;
        for (int i = 0; i < count; i++)
            crc = (crc >> 8) ^ _crc32Table[(crc ^ data[offset + i]) & 0xFFu];
        return ~crc;
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

    // Send $SCR:<name> if a screen was requested, then $SS to snapshot the
    // pendant's framebuffer. The pendant streams:
    //   $SCR:OK                                (only when a switch was asked)
    //   $SS:BEGIN <w> <h> <bytesPerPixel> <byteSwap>
    //   $SS:D<hex...>                          (repeated)
    //   $SS:END
    // Both requests share the direct-USB handler (the dongle can't move a
    // 300 KB framebuffer). Result is a PNG-encoded byte array.
    public async Task<byte[]> CaptureScreenAsync(string? screen, CancellationToken ct)
    {
        var handler = _pendantUsbHandler is { IsConnected: true } ? _pendantUsbHandler : _serialHandler;
        if (handler is not { IsConnected: true })
            throw new InvalidOperationException("Pendant not connected via USB — screenshot requires the direct USB link.");

        var lines = new System.Collections.Concurrent.BlockingCollection<string>(new System.Collections.Concurrent.ConcurrentQueue<string>());
        void OnLine(string line)
        {
            if (line.StartsWith("$SS:", StringComparison.Ordinal) || line.StartsWith("$SCR:", StringComparison.Ordinal))
                lines.Add(line);
        }

        handler.RawMessageReceived += OnLine;
        try
        {
            async Task<string> ReadLine(int timeoutMs)
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(timeoutMs);
                try { return await Task.Run(() => lines.Take(cts.Token), cts.Token); }
                catch (OperationCanceledException) { throw new TimeoutException("Pendant did not respond within " + timeoutMs + " ms"); }
            }

            if (!string.IsNullOrEmpty(screen))
            {
                await handler.SendRawAsync($"$SCR:{screen}");
                var reply = await ReadLine(2000);
                if (reply.StartsWith("$SCR:ERROR:", StringComparison.Ordinal))
                    throw new InvalidOperationException("Screen switch failed: " + reply["$SCR:ERROR:".Length..]);
                if (reply != "$SCR:OK")
                    throw new InvalidOperationException("Unexpected screen-switch reply: " + reply);
                await Task.Delay(300, ct);
            }

            await handler.SendRawAsync("$SS");
            string begin;
            do { begin = await ReadLine(3000); }
            while (!begin.StartsWith("$SS:BEGIN", StringComparison.Ordinal) && !begin.StartsWith("$SS:ERROR:", StringComparison.Ordinal));
            if (begin.StartsWith("$SS:ERROR:", StringComparison.Ordinal))
                throw new InvalidOperationException("Pendant screenshot failed: " + begin["$SS:ERROR:".Length..]);

            var parts = begin.Split(' ');
            if (parts.Length < 5) throw new InvalidOperationException("Malformed $SS:BEGIN: " + begin);
            int w = int.Parse(parts[1], CultureInfo.InvariantCulture);
            int h = int.Parse(parts[2], CultureInfo.InvariantCulture);
            int bpp = int.Parse(parts[3], CultureInfo.InvariantCulture);
            int swap = int.Parse(parts[4], CultureInfo.InvariantCulture);
            if (bpp != 2) throw new InvalidOperationException("Unsupported bpp=" + bpp + " (need 2)");

            var raw = new byte[w * h * 2];
            int written = 0;
            while (true)
            {
                var line = await ReadLine(5000);
                if (line == "$SS:END") break;
                if (!line.StartsWith("$SS:D", StringComparison.Ordinal)) continue;
                var hex = line.AsSpan(5);
                for (int i = 0; i + 1 < hex.Length && written < raw.Length; i += 2)
                {
                    raw[written++] = (byte)((HexNibble(hex[i]) << 4) | HexNibble(hex[i + 1]));
                }
            }

            if (written != raw.Length)
                throw new InvalidOperationException($"Short framebuffer: got {written}/{raw.Length} bytes");

            return EncodePngFromRgb565(raw, w, h, swap != 0);
        }
        finally
        {
            handler.RawMessageReceived -= OnLine;
            lines.CompleteAdding();
        }
    }

    private static int HexNibble(char c)
    {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return 0;
    }

    // RGB565 (with optional byte-swap) → 8-bit RGB → minimal PNG. The tiny
    // encoder here writes uncompressed IDAT deflate blocks (BTYPE 00) so we
    // don't drag zlib/DeflateStream into the AOT surface. Output is a valid
    // PNG that any image tool decodes; file size is roughly framebuffer * 1.
    private static byte[] EncodePngFromRgb565(byte[] src, int w, int h, bool byteSwap)
    {
        int rowStride = 1 + w * 3;
        var filtered = new byte[rowStride * h];
        int pi = 0;
        for (int y = 0; y < h; y++)
        {
            int rowStart = y * rowStride;
            filtered[rowStart] = 0;
            int dst = rowStart + 1;
            for (int x = 0; x < w; x++)
            {
                byte lo = src[pi++];
                byte hi = src[pi++];
                ushort px = byteSwap ? (ushort)((lo << 8) | hi) : (ushort)((hi << 8) | lo);
                int r5 = (px >> 11) & 0x1F;
                int g6 = (px >> 5) & 0x3F;
                int b5 = px & 0x1F;
                filtered[dst++] = (byte)((r5 << 3) | (r5 >> 2));
                filtered[dst++] = (byte)((g6 << 2) | (g6 >> 4));
                filtered[dst++] = (byte)((b5 << 3) | (b5 >> 2));
            }
        }

        var deflate = new List<byte>(filtered.Length + 12);
        deflate.Add(0x78); deflate.Add(0x01);
        const int block = 65535;
        for (int off = 0; off < filtered.Length; off += block)
        {
            int len = Math.Min(block, filtered.Length - off);
            bool last = (off + len) >= filtered.Length;
            deflate.Add(last ? (byte)0x01 : (byte)0x00);
            deflate.Add((byte)(len & 0xFF));
            deflate.Add((byte)((len >> 8) & 0xFF));
            deflate.Add((byte)(~len & 0xFF));
            deflate.Add((byte)((~len >> 8) & 0xFF));
            for (int i = 0; i < len; i++) deflate.Add(filtered[off + i]);
        }
        uint adler = Adler32(filtered, 0, filtered.Length);
        deflate.Add((byte)((adler >> 24) & 0xFF));
        deflate.Add((byte)((adler >> 16) & 0xFF));
        deflate.Add((byte)((adler >> 8) & 0xFF));
        deflate.Add((byte)(adler & 0xFF));

        using var ms = new MemoryStream();
        void W(byte[] b) => ms.Write(b, 0, b.Length);
        void WU32(uint v) { ms.WriteByte((byte)((v >> 24) & 0xFF)); ms.WriteByte((byte)((v >> 16) & 0xFF)); ms.WriteByte((byte)((v >> 8) & 0xFF)); ms.WriteByte((byte)(v & 0xFF)); }
        void Chunk(string type, byte[] data)
        {
            WU32((uint)data.Length);
            var typeBytes = Encoding.ASCII.GetBytes(type);
            var crcBuf = new byte[typeBytes.Length + data.Length];
            Buffer.BlockCopy(typeBytes, 0, crcBuf, 0, typeBytes.Length);
            Buffer.BlockCopy(data, 0, crcBuf, typeBytes.Length, data.Length);
            W(typeBytes); W(data);
            WU32(Crc32(crcBuf, 0, crcBuf.Length));
        }
        W(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
        var ihdr = new byte[13];
        ihdr[0] = (byte)((w >> 24) & 0xFF); ihdr[1] = (byte)((w >> 16) & 0xFF); ihdr[2] = (byte)((w >> 8) & 0xFF); ihdr[3] = (byte)(w & 0xFF);
        ihdr[4] = (byte)((h >> 24) & 0xFF); ihdr[5] = (byte)((h >> 16) & 0xFF); ihdr[6] = (byte)((h >> 8) & 0xFF); ihdr[7] = (byte)(h & 0xFF);
        ihdr[8] = 8;
        ihdr[9] = 2;
        ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
        Chunk("IHDR", ihdr);
        Chunk("IDAT", deflate.ToArray());
        Chunk("IEND", Array.Empty<byte>());
        return ms.ToArray();
    }

    private static uint Adler32(byte[] data, int offset, int count)
    {
        const uint MOD = 65521;
        uint a = 1, b = 0;
        for (int i = 0; i < count; i++)
        {
            a = (a + data[offset + i]) % MOD;
            b = (b + a) % MOD;
        }
        return (b << 16) | a;
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
        var dongle = _dongleHandler;
        if (dongle is not null)
        {
            _dongleHandler = null;
            await dongle.DisconnectAsync();
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
        var handler = _dongleHandler;
        if (handler is not { IsConnected: true })
            throw new InvalidOperationException("Dongle not connected");

        _logger.LogInformation("Sending $UNPAIR to dongle");
        await handler.SendRawAsync("$UNPAIR");
        await Task.Delay(500);
        _logger.LogInformation("Dongle unpair command sent");
    }

    #endregion

    #region Auto-Connect (Scanner-based)

    public HashSet<string> GetOccupiedPorts()
    {
        if (_scanner is not null)
            return _scanner.AllOccupiedPorts;
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    public void StartAutoConnect()
    {
        var autoConnect = _settingsManager.GetSetting<bool>("pendant.autoConnect", true);
        if (!autoConnect) return;
        if (!_controller.IsConnected) return;
        if (_scanner is not null) return; // Already running

        _scanner = new PendantPortScanner(_logger, _usbCatalog);
        _scanner.DeviceFound += OnScannerDeviceFound;
        _scanner.DeviceLost += OnScannerDeviceLost;
        _scanner.LegacyCandidateDetected += OnLegacyCandidateDetected;
        _scanner.Start();
    }

    public void StopAutoConnect()
    {
        if (_scanner is null) return;
        _scanner.Stop();
        _scanner.DeviceFound -= OnScannerDeviceFound;
        _scanner.DeviceLost -= OnScannerDeviceLost;
        _scanner.LegacyCandidateDetected -= OnLegacyCandidateDetected;
        _scanner.Dispose();
        _scanner = null;
        _logger.LogInformation("Pendant scanner stopped (CNC disconnected)");
    }

    // Fired when the USB catalog surfaces a VID=0x303A / PID=0x1001 device
    // that doesn't match any known iProduct string — almost certainly an
    // ncSender pendant or wireless dongle running legacy firmware. The
    // scanner does NOT open the port; instead we ask the UI to prompt
    // the user to update firmware. One broadcast per new port per session.
    private void OnLegacyCandidateDetected(NcSenderUsbDevice device)
    {
        var notice = new LegacyFirmwareNotice(
            device.PortName,
            "0x" + device.Vid.ToString("X4"),
            "0x" + device.Pid.ToString("X4"),
            "An ESP32 USB device was detected but is not identified as an ncSender accessory. If this is your pendant or wireless USB on legacy firmware, update it from Settings → Pendant Firmware / Wireless USB.");
        _ = _broadcaster.Broadcast("accessory:legacy-firmware-detected", notice,
            NcSenderJsonContext.Default.LegacyFirmwareNotice);
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
                // The paired list lives in the dongle's own NVS, so it belongs to
                // that piece of hardware and not to this process. Swap dongles and
                // every entry we hold is about a device the new one has never
                // heard of, so drop them all before asking this one what it has.
                _dongleDevices.BeginEnumeration();
                // Seed the paired-device table from the dongle's persistent NVS.
                // Fire-and-forget with a small retry loop: on the USB-catalog
                // fast path the port was opened milliseconds ago and TinyUSB
                // CDC on ESP32-S3 doesn't always deliver the first write to
                // firmware on Windows (the slow path effectively hid this
                // behind its 1.5 s passive-listen window). $DEVICES is
                // idempotent — retry until the device list seeds or we
                // exhaust attempts.
                _ = Task.Run(async () =>
                {
                    for (int attempt = 0; attempt < 4; attempt++)
                    {
                        await Task.Delay(attempt == 0 ? 500 : 1000).ConfigureAwait(false);
                        try { await _dongleDevices.RequestDevicesAsync().ConfigureAwait(false); }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to seed paired-device list from dongle (attempt {N})", attempt + 1);
                        }
                        // Give the reply time to land before judging the attempt.
                        // Checking immediately after the write always saw "not yet
                        // answered" — the reply takes a few hundred ms — so every
                        // attach sent $DEVICES twice and seeded the list twice.
                        for (var wait = 0; wait < 12 && !_dongleDevices.DevicesEnumerated; wait++)
                            await Task.Delay(50).ConfigureAwait(false);
                        // Bail once the dongle has actually answered. Testing the
                        // device count instead would be wrong twice over: a dongle
                        // with no peers yet would look like a failure and burn every
                        // retry, and stale entries from a previous dongle would look
                        // like success and skip the query altogether.
                        if (_dongleDevices.DevicesEnumerated) return;
                    }
                });
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

            // Always send DRO if port is open — pendant treats DRO as connection proof.
            // Emit a FULL frame every ~5 s so any delta lost in flight (broadcast DRO
            // has no ACK/retry) self-corrects within that window. Otherwise a missed
            // "P:" or "W:" leaves the pendant's cached copy stale until the next
            // job/pair event, showing up as an occasional wildly-wrong MPos while idle.
            var fullDro = (++_droFrameCounter % FullDroEveryNTicks) == 0;
            if (_serialHandler?.IsConnected == true)
            {
                _ = SendDroAsync(full: fullDro);

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
            // Intercept OTA responses during firmware flashing. V2 protocol
            // uses $A:/$N: ACK-and-NAK lines in addition to the classic $OTA:*
            // frames — dispatch all three so a route through the main handler
            // (e.g. USB pendant running dongle-active mode) still sees them.
            if (_otaResponseHandler is not null
                && (data.StartsWith("$OTA:") || data.StartsWith("$A:") || data.StartsWith("$N:")))
            {
                _otaResponseHandler(data);
                return;
            }

            // Addressed device traffic "@name payload" (e.g. "@autodustboot status …")
            // is routed to its manager, not the pendant command path. Same route also
            // catches "$DEVICES:<name>" replies used to seed the paired-device list.
            // "$OTA:ACK …" with no "@name" is the dongle answering about its OWN
            // firmware update. It only reaches here when no pendant flash owns
            // the OTA handler above, so the pendant path keeps priority and this
            // claims the untagged remainder.
            if (data.StartsWith('@')
                || data.StartsWith("$DEVICES:", StringComparison.Ordinal)
                || data.StartsWith("$OTA:ACK ", StringComparison.Ordinal))
            {
                _dongleDevices.OnDongleLine(data);
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

            // Outputs screen commands from the pendant. Format:
            //   "AUX <id> on|off"  — toggle a configured aux output by id
            //   "SLOT <n>"         — load tool at slot n via M6T<n>
            //   "UNLOAD"           — drop the loaded tool (M6T0)
            //   "MANUAL"           — load the manual tool: M6 T(slotCount+1),
            //                       i.e. a tool number just past the ATC
            //                       magazine so tool-changer plugins fall
            //                       through to their manual-load path.
            //   "TLS"              — trigger toolsetter probe ($TLS)
            if (data.StartsWith("AUX ", StringComparison.Ordinal))
            {
                _ = HandlePendantAuxAsync(data.Substring(4));
                return;
            }
            if (data.StartsWith("SLOT ", StringComparison.Ordinal))
            {
                if (int.TryParse(data.AsSpan(5).Trim(), out var slot) && slot > 0)
                    _ = HandleCncCommandCoreAsync($"M6T{slot}");
                return;
            }
            if (data == "UNLOAD")
            {
                _ = HandleCncCommandCoreAsync("M6T0");
                return;
            }
            if (data == "MANUAL")
            {
                // Manual tool sits at slotCount + 1 — the same target
                // ncSender's Outputs screen Manual long-press uses.
                var slots = ReadAtcSlotCount();
                var manualTool = (slots > 0 ? slots : 0) + 1;
                _ = HandleCncCommandCoreAsync($"M6T{manualTool}");
                return;
            }
            if (data == "TLS")
            {
                _ = HandleCncCommandCoreAsync("$TLS");
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
                case "gate:respond":
                    if (root.TryGetProperty("data", out var grData)
                        && grData.TryGetProperty("gateId", out var grIdEl)
                        && grIdEl.GetString() is string grId)
                    {
                        var val = grData.TryGetProperty("value", out var vEl) ? vEl.GetString() : null;
                        _gates.Resolve(grId, val);
                    }
                    break;
                case "gate:step-fire":
                    if (root.TryGetProperty("data", out var gsData)
                        && gsData.TryGetProperty("gateId", out var gsIdEl)
                        && gsIdEl.GetString() is string gsId
                        && gsData.TryGetProperty("stepIndex", out var gsIdxEl)
                        && gsIdxEl.TryGetInt32(out var gsIdx))
                    {
                        _ = _gates.FireStepAsync(gsId, gsIdx);
                    }
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
        var dead = _serialHandler;
        DetachActiveHandler();
        _serialHandler = null;

        // Drop every other reference to the same dead handler. Clearing only
        // _serialHandler used to leave _dongleHandler pointing at it, so
        // GetStatus kept reporting DongleConnected: true while $LICENSE queries
        // went to a fd nothing would ever answer — the toolbar icon stayed lit
        // and the Wireless USB dialog said "not connected" until a restart.
        if (dead is not null)
        {
            if (ReferenceEquals(_dongleHandler, dead))
            {
                DetachDonglePromotionListener();
                _dongleHandler = null;
            }
            if (ReferenceEquals(_pendantUsbHandler, dead))
                _pendantUsbHandler = null;
        }

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
                // Space the initial handshake sends. Over ESP-NOW, each JSON
                // (settings + outputs-config) fragments into 3-4 packets;
                // firing them back-to-back after the DRO overwhelms the
                // dongle's radio queue and the second/third payload drops,
                // which is why the Outputs screen used to open empty.
                await SendDroAsync(full: true);
                await Task.Delay(200);
                await SendSettings(force: true);
                await Task.Delay(200);
                await SendOutputsConfig(force: true);
                await Task.Delay(200);
                await _serialHandler.SendMessageAsync(
                    new PendantTypeMsg("request:metadata"),
                    PendantJsonContext.Default.PendantTypeMsg);

                // Catch-up: mirror any currently-open gate to a fresh pendant
                // (server may have opened it before pendant connected, or the
                // pendant just booted mid-flow).
                await PushGatesActiveAsync();
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

        // Pendant sent us metadata unprompted → it just booted (post-OTA,
        // hard-reset, brown-out, etc.). Over ESP-NOW the serial link to the
        // dongle stays open through a pendant reboot, so the usual PortDisconnected
        // → _pendantConnected=false → HandlePingAsync full-handshake path
        // never fires. Result: pendant comes back with empty aux/tool state
        // until the operator re-saves settings. Force a re-push here to
        // rehydrate: reset the dedup caches, then re-send outputs + settings
        // (SendDroAsync is already covered by the periodic push).
        _ = Task.Run(async () =>
        {
            try
            {
                _lastSentOutputsCfg = null;
                _lastSentSettings = null;
                // Space the sends so ESP-NOW fragmentation doesn't drop the
                // second frame (same reason HandlePingAsync uses 200 ms gaps).
                await SendOutputsConfig(force: true);
                await Task.Delay(200);
                await SendSettings(force: true);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Post-metadata re-push failed");
            }
        });
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

    // Handle "AUX <id> on|off" from the pendant. Looks up the aux id in
    // the last config we pushed (so we only ever send commands the user
    // explicitly configured in Settings > Auxiliary I/O), then routes
    // the matching on/off command through the normal command processor.
    private async Task HandlePendantAuxAsync(string payload)
    {
        try
        {
            var parts = payload.Trim().Split(' ', 2);
            if (parts.Length != 2)
            {
                _logger.LogWarning("Pendant AUX ignored — bad payload shape: {Payload}", payload);
                return;
            }
            var id = parts[0];
            var state = parts[1].Trim().ToLowerInvariant();
            var aux = _lastSentOutputsCfg?.Aux;
            if (aux is null)
            {
                _logger.LogWarning("Pendant AUX '{Id} {State}' dropped — no outputs config sent to pendant yet", id, state);
                return;
            }
            foreach (var entry in aux)
            {
                if (!string.Equals(entry.Id, id, StringComparison.Ordinal)) continue;
                var cmd = state == "on" ? entry.On : entry.Off;
                if (string.IsNullOrEmpty(cmd))
                {
                    _logger.LogWarning("Pendant AUX '{Id} {State}' has empty command in config — nothing to send", id, state);
                    return;
                }
                _logger.LogInformation("Pendant AUX '{Id} {State}' → {Cmd}", id, state, cmd);
                await HandleCncCommandCoreAsync(cmd);
                return;
            }
            var known = string.Join(",", aux.Select(a => a.Id));
            _logger.LogWarning("Pendant AUX '{Id} {State}' dropped — id not in outputs config (known: [{Known}])", id, state, known);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Pendant AUX command failed: {Payload}", payload);
        }
    }

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

    #region Gate Dialog Mirroring

    // Fires from IBroadcaster.MessageBroadcast (posted by WebSocketLayer.Broadcast).
    // Forward gate:show and gate:close to the pendant as-is; the JsonElement
    // was already serialised in the browser-facing camelCase shape, so the
    // pendant's ArduinoJson parse can key off `gateId`, `title`, etc. directly.
    // We intentionally ignore step-update broadcasts too (they arrive as
    // fresh gate:show frames with an incremented stepProgress — the pendant
    // treats gate:show as an upsert).
    private void OnBroadcastToPendant(string type, JsonElement data)
    {
        if (type is not ("gate:show" or "gate:close")) return;
        if (_serialHandler is not { IsConnected: true }) return;

        _ = ForwardToPendantAsync(type, data);
    }

    private async Task ForwardToPendantAsync(string type, JsonElement data)
    {
        try
        {
            await _serialHandler!.SendMessageAsync(
                new PendantTypeDataMsg(type, data),
                PendantJsonContext.Default.PendantTypeDataMsg);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to forward {Type} to pendant", type);
        }
    }

    private async Task PushGatesActiveAsync()
    {
        if (_serialHandler is not { IsConnected: true }) return;
        var active = _gates.Active();
        if (active.Count == 0) return;

        try
        {
            // Serialise the WsGateActive payload using the main JSON context —
            // the pendant treats gate:active as an array of gate:show payloads.
            var payload = new NcSender.Server.Infrastructure.WsGateActive(active
                .Select(NcSender.Server.GateDialog.GateDialogService.ToWsShow)
                .ToList());
            var el = System.Text.Json.JsonSerializer.SerializeToElement(
                payload, NcSender.Server.Infrastructure.NcSenderJsonContext.Default.WsGateActive);
            await _serialHandler.SendMessageAsync(
                new PendantTypeDataMsg("gate:active", el),
                PendantJsonContext.Default.PendantTypeDataMsg);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to push gate:active to pendant");
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
        var maxAccelX = ms.MaxAccelerationX;
        var maxAccelY = ms.MaxAccelerationY;
        var maxAccelZ = ms.MaxAccelerationZ;
        var maxTravelX = ms.MaxTravelX;
        var maxTravelY = ms.MaxTravelY;
        var maxTravelZ = ms.MaxTravelZ;
        // Units: send "in" only when the app is in imperial mode; the
        // pendant defaults to mm when U: is absent (backward compat).
        var units = string.Equals(
            _settingsManager.GetSetting<string>("unitsPreference", "metric"),
            "imperial", StringComparison.OrdinalIgnoreCase) ? "in" : "mm";

        // Send the DERIVED sender status (ServerContext.ComputeSenderStatus)
        // rather than the raw grblHAL status. Same signal the browser
        // toolbar renders — includes "tool-changing", "probing", door/hold
        // promotion — so the pendant header reads the same as the app.
        var effectiveStatus = state.SenderStatus;
        if (string.IsNullOrEmpty(effectiveStatus)) effectiveStatus = ms.Status ?? "Unknown";
        var pnHasDoor = (ms.Pn ?? "").Contains('D');
        if (pnHasDoor)
            effectiveStatus = "Door";
        else if (string.Equals(effectiveStatus, "Door", StringComparison.OrdinalIgnoreCase))
            effectiveStatus = "Hold";

        // Aux output state mask — bit N corresponds to the Nth entry
        // in the aux list we most recently pushed to the pendant.
        // Order must match _lastSentOutputsCfg.Aux, so walk that list
        // and look each row up in MachineState.
        uint auxMask = 0;
        var aux = _lastSentOutputsCfg?.Aux;
        if (aux is not null)
        {
            for (int i = 0; i < aux.Length && i < 32; i++)
            {
                if (IsAuxOn(aux[i].On, ms)) auxMask |= (1u << i);
            }
        }

        var currentTool = ms.Tool;

        var current = new PendantDroSnapshot(
            Status: effectiveStatus,
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
            MaxFeedZ: maxFeedZ,
            MaxAccelX: maxAccelX,
            MaxAccelY: maxAccelY,
            MaxAccelZ: maxAccelZ,
            MaxTravelX: maxTravelX,
            MaxTravelY: maxTravelY,
            MaxTravelZ: maxTravelZ,
            AuxMask: auxMask,
            CurrentTool: currentTool,
            Units: units
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

        // Always emit F/R on delta — even when the new value is 0.
        // Previously we skipped 0 in delta packets to save bytes, but that
        // means a >0 → 0 transition never reaches the pendant and the DRO
        // stays stuck showing the last non-zero feedrate / RPM.
        if (isFull || current.FeedRate != prev!.FeedRate)
            sb.Append($"|F:{current.FeedRate}");

        if (isFull || current.SpindleRpm != prev!.SpindleRpm)
            sb.Append($"|R:{current.SpindleRpm}");

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

        // Per-axis max acceleration (mm/s²) from $120/$121/$122. Prefix "L"
        // for acceleration Limit — "A" is already claimed by the alarm-
        // code field. Consumers use this to size jog behaviour to real
        // machine kinematics (e.g. pendant Z jog feed cap = 60·√(2·a·s)).
        if (isFull || current.MaxAccelX != prev!.MaxAccelX || current.MaxAccelY != prev!.MaxAccelY || current.MaxAccelZ != prev!.MaxAccelZ)
            sb.Append($"|L:{current.MaxAccelX:F0},{current.MaxAccelY:F0},{current.MaxAccelZ:F0}");

        // Per-axis max travel (mm) from $130/$131/$132. Prefix "E" for
        // Extent. The RGB strip mirrors E:x into its own xmax NVS so the
        // X-follower auto-sizes to the machine without a manual entry.
        if (isFull || current.MaxTravelX != prev!.MaxTravelX || current.MaxTravelY != prev!.MaxTravelY || current.MaxTravelZ != prev!.MaxTravelZ)
            sb.Append($"|E:{current.MaxTravelX:F0},{current.MaxTravelY:F0},{current.MaxTravelZ:F0}");

        // Aux state bitmask (hex) — drives the Outputs screen's toggle
        // states. Absent in delta when unchanged.
        if (isFull || current.AuxMask != prev!.AuxMask)
            sb.Append($"|X:{current.AuxMask:X}");

        // Currently-loaded tool number — for the Tools card's badge.
        if (isFull || current.CurrentTool != prev!.CurrentTool)
            sb.Append($"|T:{current.CurrentTool}");

        // Units preference — "in" only when imperial. Omitted for mm
        // so the packet stays compact and old pendants keep working
        // (absence = mm on the pendant parser).
        if (isFull || current.Units != prev!.Units)
        {
            if (current.Units == "in") sb.Append("|U:in");
            else if (isFull) sb.Append("|U:mm");
        }

        _lastSentDro = current;
        await _serialHandler.SendRawAsync(sb.ToString());
    }

    // Given an aux entry's "on" command (e.g. "M8", "M7", "M64 P2"),
    // return whether that pin/channel is currently on. Used to build
    // the aux state bitmask in the DRO push.
    private static bool IsAuxOn(string onCmd, MachineState ms)
    {
        if (string.IsNullOrEmpty(onCmd)) return false;
        if (onCmd == "M8") return ms.FloodCoolant;
        if (onCmd == "M7") return ms.MistCoolant;
        var m = System.Text.RegularExpressions.Regex.Match(onCmd, @"^M64\s+P(\d+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (m.Success && int.TryParse(m.Groups[1].Value, out var pin))
        {
            // OutputPinsState is a LIST OF ACTIVE PIN NUMBERS, not an
            // index-addressed table — a pin-0 aux (e.g. ATC) evaluating
            // `pins[0] != 0` always yielded false, so the pendant kept
            // resending "on" instead of alternating.
            var pins = ms.OutputPinsState;
            return pins is not null && pins.Contains(pin);
        }
        return false;
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
        double MaxFeedZ,
        double MaxAccelX,
        double MaxAccelY,
        double MaxAccelZ,
        double MaxTravelX,
        double MaxTravelY,
        double MaxTravelZ,
        uint AuxMask,     // bit N = state of the Nth entry in the pendant's aux list
        int CurrentTool,  // 0 = none
        string Units      // "mm" or "in" — drives the pendant DRO display unit
    );

    #endregion

    #region Settings Sync

    public void NotifySettingsChanged()
    {
        // Same spacing rule as the initial handshake: back-to-back JSON
        // sends over ESP-NOW lose the second/third payload.
        _ = Task.Run(async () =>
        {
            await SendSettings(force: true);
            await Task.Delay(200);
            await SendOutputsConfig(force: true);
        });
    }

    // Push aux output definitions + pneumatic ATC slot count to the
    // pendant's Outputs screen. Sent on pendant connect and whenever
    // settings change. Live on/off state and current tool ride on the
    // DRO delta (see SendDroAsync).
    private PendantOutputsConfigSnapshot? _lastSentOutputsCfg;

    private Task SendOutputsConfig(bool force = false)
    {
        if (_serialHandler is not { IsConnected: true } || !_pendantConnected)
            return Task.CompletedTask;

        var auxNode = _settingsManager.GetSetting("auxOutputs");
        var auxList = new List<PendantAuxOutput>();
        if (auxNode is System.Text.Json.Nodes.JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is not System.Text.Json.Nodes.JsonObject obj) continue;
                var enabled = obj["enabled"]?.GetValue<bool>() ?? true;
                if (!enabled) continue;
                var id       = obj["id"]?.GetValue<string>() ?? "";
                var name     = obj["name"]?.GetValue<string>() ?? "";
                var onCmd    = obj["on"]?.GetValue<string>() ?? "";
                var offCmd   = obj["off"]?.GetValue<string>() ?? DeriveOffFromOn(onCmd);
                var hold     = obj["holdToActivate"]?.GetValue<bool>() ?? false;
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(name)) continue;
                auxList.Add(new PendantAuxOutput(id, name, onCmd, offCmd, true, hold));
            }
        }

        // Seed the pendant with Flood/Mist when the user hasn't configured
        // any aux outputs — matches what the desktop client shows in that
        // case (see GCodeVisualizer.vue's ioSwitchesConfig fallback). Without
        // this the pendant Outputs screen is blank for anyone who never
        // added a custom aux, even though M7/M8 are always available.
        if (auxList.Count == 0)
        {
            auxList.Add(new PendantAuxOutput("flood", "Flood", "M8", "M9", true, false));
            auxList.Add(new PendantAuxOutput("mist",  "Mist",  "M7", "M9", true, false));
        }

        var slotCount = ReadAtcSlotCount();

        var snapshot = new PendantOutputsConfigSnapshot(auxList.ToArray(), slotCount);
        if (!force && _lastSentOutputsCfg is not null && snapshot.Equals(_lastSentOutputsCfg))
            return Task.CompletedTask;
        _lastSentOutputsCfg = snapshot;

        var msg = new PendantOutputsConfigMsg(
            "outputs-config",
            new PendantOutputsConfigData(snapshot.Aux, snapshot.SlotCount));
        return _serialHandler.SendMessageAsync(msg, PendantJsonContext.Default.PendantOutputsConfigMsg);
    }

    private static string DeriveOffFromOn(string onCmd)
    {
        if (string.IsNullOrEmpty(onCmd)) return "";
        if (onCmd == "M7" || onCmd == "M8") return "M9";
        var m = System.Text.RegularExpressions.Regex.Match(onCmd, @"^M64\s+(P\d+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (m.Success) return $"M65 {m.Groups[1].Value}";
        return "";
    }

    // The pendant's Outputs screen renders "T?/N" where N is the tool
    // magazine size. Rather than sniffing one specific plugin's config
    // file (which broke for RapidChangeATC — its slots live under a
    // different key), read the canonical `tool.count` setting that
    // every ATC-shaped plugin writes when it saves (see the PATCH
    // /api/settings call in pneumaticatc / rapidchangeatc config.html,
    // and ToolService.cs uses the same key to gate magazine bounds).
    private int ReadAtcSlotCount()
    {
        try { return _settingsManager.GetSetting<int>("tool.count", 0); }
        catch { return 0; }
    }

    private sealed record PendantOutputsConfigSnapshot(PendantAuxOutput[] Aux, int SlotCount)
    {
        public bool Equals(PendantOutputsConfigSnapshot? other)
        {
            if (other is null || other.SlotCount != SlotCount || other.Aux.Length != Aux.Length) return false;
            for (int i = 0; i < Aux.Length; i++)
                if (!Aux[i].Equals(other.Aux[i])) return false;
            return true;
        }
        public override int GetHashCode() => HashCode.Combine(SlotCount, Aux.Length);
    }

    private Task SendSettings(bool force = false)
    {
        if (_serialHandler is not { IsConnected: true } || !_pendantConnected)
            return Task.CompletedTask;

        var theme = _settingsManager.GetSetting<string>("theme") ?? "dark";
        var snapshot = new PendantSettingsSnapshot(
            Theme: theme,
            AccentColor: _settingsManager.GetSetting<string>("accentColor") ?? _settingsManager.GetSetting<string>("primaryColor"),
            GradientColor: _settingsManager.GetSetting<string>("gradientColor"),
            DarkMode: string.Equals(theme, "dark", StringComparison.OrdinalIgnoreCase)
        );

        if (!force && _lastSentSettings is not null && snapshot == _lastSentSettings)
            return Task.CompletedTask;

        _lastSentSettings = snapshot;

        var msg = new PendantSettingsMsg("settings-changed", new PendantSettingsData(
            snapshot.Theme,
            snapshot.AccentColor,
            snapshot.GradientColor,
            snapshot.DarkMode
        ));

        return _serialHandler.SendMessageAsync(msg, PendantJsonContext.Default.PendantSettingsMsg);
    }

    private record PendantSettingsSnapshot(
        string? Theme,
        string? AccentColor,
        string? GradientColor,
        bool DarkMode
    );

    #endregion
}
