using NcSender.Core.Interfaces;

namespace NcSender.Server.Dongle;

/// <summary>
/// Translates <c>@rcatc</c> device messages coming off the ESP-NOW dongle into
/// grblHAL virtual-input realtime bytes on the controller. The compact wire
/// payload carries channel-source + state + type + seq:
///
///   <c>@rcatc &lt;state&gt;:&lt;type&gt;:&lt;seq&gt;:&lt;src&gt;</c>
///
///   e.g.  <c>1:E:42:P</c>  →  <c>0xA5</c>  (assert probe)
///         <c>0:E:43:P</c>  →  <c>0xA6</c>  (release probe)
///         <c>1:E:44:T</c>  →  <c>0xA7</c>  (assert toolsetter)
///         <c>0:E:45:T</c>  →  <c>0xA8</c>  (release toolsetter)
///
/// grblHAL's virtual-inputs plugin latches these as real contact edges so
/// <c>G38.x</c> (or <c>G38.x P1</c> for the toolsetter) stops on them.
/// Emission must skip any encoding/decoding layer that would UTF-8-mangle
/// bytes above 0x7F; <see cref="ICncController.WriteRawAsync"/> is the raw-
/// byte path used elsewhere for feedhold / status request.
///
/// Hooked to <see cref="IDongleDeviceService.DeviceMessageReceived"/> rather
/// than the WS relay because the WS path is throttled ~1/sec — unusable when
/// the whole point is minimum edge-to-controller latency.
///
/// Backward compat: payloads without the trailing <c>:P</c>/<c>:T</c> field
/// (older firmware) are treated as probe channel.
/// </summary>
public sealed class RcatcTranslator : IHostedService
{
    private const string DeviceName = "rcatc";
    private const byte ProbeAssert       = 0xA5;
    private const byte ProbeRelease      = 0xA6;
    private const byte ToolsetterAssert  = 0xA7;
    private const byte ToolsetterRelease = 0xA8;

    private readonly IDongleDeviceService _devices;
    private readonly ICncController _controller;
    private readonly ILogger<RcatcTranslator> _logger;

    // Per-channel dedup. '0'|'1' once seen, 0 = unknown. First message after
    // boot / reconnect always writes so a lost edge self-heals to whatever
    // state the device currently reports.
    private char _lastProbeState;
    private char _lastToolsetterState;

    public RcatcTranslator(
        IDongleDeviceService devices,
        ICncController controller,
        ILogger<RcatcTranslator> logger)
    {
        _devices = devices;
        _controller = controller;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _devices.DeviceMessageReceived += OnDeviceMessage;
        _devices.DeviceConnectivityChanged += OnDeviceConnectivity;
        _controller.ConnectionStatusChanged += OnControllerConnection;
        // Initial poll — device may already be paired+connected when the host
        // starts. Firing "status" makes the XIAO re-emit both channels' current
        // state; our dedup starts at 0 so whatever it reports writes the byte.
        _ = TryPollAsync("startup");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _devices.DeviceMessageReceived -= OnDeviceMessage;
        _devices.DeviceConnectivityChanged -= OnDeviceConnectivity;
        _controller.ConnectionStatusChanged -= OnControllerConnection;
        return Task.CompletedTask;
    }

    // Fires when a peer's link comes up (or drops). We only care about our
    // device reconnecting: forget last-known state and poll for fresh so the
    // controller can be re-driven to reality even if the current state
    // matches what we thought we knew before the disconnect.
    private void OnDeviceConnectivity(string name, bool connected)
    {
        if (!string.Equals(name, DeviceName, StringComparison.OrdinalIgnoreCase)) return;
        if (!connected) return;
        _lastProbeState = _lastToolsetterState = (char)0;
        _ = TryPollAsync("device reconnect");
    }

    // Fires when the controller connection comes up (or drops). A fresh
    // controller has no idea about virtual-input state; on reconnect we clear
    // our dedup so the next incoming XIAO message re-drives the virtual pins.
    private void OnControllerConnection(string status, bool connected)
    {
        if (!connected) return;
        _lastProbeState = _lastToolsetterState = (char)0;
        _ = TryPollAsync("controller reconnect");
    }

    private async Task TryPollAsync(string reason)
    {
        try
        {
            await _devices.SendAsync(DeviceName, "status");
            _logger.LogDebug("RCATC state resync polled ({Reason})", reason);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "RcatcTranslator: status poll ({Reason}) failed — device likely offline; heartbeat will self-heal within ~3s", reason);
        }
    }

    private void OnDeviceMessage(string name, string payload)
    {
        if (!string.Equals(name, DeviceName, StringComparison.OrdinalIgnoreCase)) return;
        if (string.IsNullOrEmpty(payload)) return;

        // Payload starts with '0' or '1' — anything else (control frame,
        // corrupted line) is ignored rather than translated.
        var state = payload[0];
        if (state != '0' && state != '1') return;

        // Channel-source is the trailing field: "<state>:<type>:<seq>:<src>"
        // where src is 'P' (probe) or 'T' (toolsetter). Older firmware sends
        // without the trailing field — default to probe for back-compat.
        char src = 'P';
        int lastColon = payload.LastIndexOf(':');
        if (lastColon > 0 && lastColon < payload.Length - 1)
        {
            char c = char.ToUpperInvariant(payload[lastColon + 1]);
            if (c == 'P' || c == 'T') src = c;
        }

        // Per-channel dedup — firmware heartbeats re-emit current state every
        // 3s on each channel, and app-retry may deliver the same seq twice.
        ref char lastState = ref (src == 'T' ? ref _lastToolsetterState : ref _lastProbeState);
        if (state == lastState) return;
        lastState = state;

        byte b = (src, state) switch
        {
            ('P', '1') => ProbeAssert,
            ('P', '0') => ProbeRelease,
            ('T', '1') => ToolsetterAssert,
            ('T', '0') => ToolsetterRelease,
            _ => (byte)0,
        };
        if (b == 0) return;
        _ = SendAsync(b, src);
    }

    private async Task SendAsync(byte b, char src)
    {
        try
        {
            await _controller.WriteRawAsync(new[] { b });
            _logger.LogInformation("RCATC -> controller 0x{Byte:X2} ({Action})",
                b, ActionLabel(b));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "RcatcTranslator: failed to write byte 0x{Byte:X2} to controller", b);
        }
    }

    private static string ActionLabel(byte b) => b switch
    {
        ProbeAssert       => "assert probe",
        ProbeRelease      => "release probe",
        ToolsetterAssert  => "assert toolsetter",
        ToolsetterRelease => "release toolsetter",
        _                 => "unknown",
    };
}
