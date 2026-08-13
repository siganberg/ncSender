using NcSender.Core.Interfaces;

namespace NcSender.Server.Dongle;

/// <summary>
/// Translates xprobe payloads (from either wired USB or wireless ESP-NOW,
/// arbitrated by <see cref="IXProbeSource"/>) into grblHAL virtual-input
/// realtime bytes on the controller. The compact wire payload carries
/// channel-source + state + type + seq:
///
///   <c>&lt;state&gt;:&lt;type&gt;:&lt;seq&gt;:&lt;src&gt;</c>
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
/// The translator itself doesn't know which transport (wired or wireless)
/// delivered a given payload — <see cref="IXProbeSource"/> selects the
/// authoritative one and suppresses the other while both are up.
///
/// Backward compat: payloads without the trailing <c>:P</c>/<c>:T</c> field
/// (older firmware) are treated as probe channel.
/// </summary>
public sealed class XProbeTranslator : IHostedService
{
    private const byte ProbeAssert       = 0xA5;
    private const byte ProbeRelease      = 0xA6;
    private const byte ToolsetterAssert  = 0xA7;
    private const byte ToolsetterRelease = 0xA8;

    private readonly IXProbeSource _source;
    private readonly ICncController _controller;
    private readonly ILogger<XProbeTranslator> _logger;

    // NOTE: previously kept per-channel dedup (_lastProbeState / _lastTls…)
    // to skip re-writing bytes when incoming state matched. That was WRONG:
    // when grblHAL soft-resets (e.g., after $X clear-alarm), the virtual-
    // inputs plugin zeroes its own state — but this translator's dedup
    // memory stays "1" from the last edge, so subsequent 1:H heartbeats
    // match dedup and never re-drive the pin. grblHAL is left believing
    // the probe is released while the XProbe firmware keeps insisting
    // "1:H:...:P" (physically triggered).
    //
    // Fix follows the HID keyboard/mouse model: every report (edge OR
    // heartbeat) unconditionally re-drives the controller pin. Idempotent
    // (a repeated 0xA5 on an already-asserted pin is a no-op in the plugin),
    // trivial bandwidth (heartbeats at 100ms = 20 B/s to grbl), and the
    // whole pipeline becomes self-healing — any state drift from any cause
    // (soft-reset, packet reorder, connection blip) corrects within
    // HEARTBEAT_MS of the next report.

    public XProbeTranslator(
        IXProbeSource source,
        ICncController controller,
        ILogger<XProbeTranslator> logger)
    {
        _source = source;
        _controller = controller;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _source.MessageReceived += OnMessage;
        _source.ConnectivityChanged += OnSourceConnectivity;
        _controller.ConnectionStatusChanged += OnControllerConnection;
        // Initial poll — device may already be present when the host starts.
        _ = TryPollAsync("startup");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _source.MessageReceived -= OnMessage;
        _source.ConnectivityChanged -= OnSourceConnectivity;
        _controller.ConnectionStatusChanged -= OnControllerConnection;
        return Task.CompletedTask;
    }

    // Fires when the router's active transport comes up (or drops). Just poll
    // for immediate resync — the always-forward heartbeat model handles
    // continuous state maintenance from that point on.
    private void OnSourceConnectivity(bool connected)
    {
        if (!connected) return;
        _ = TryPollAsync("source reconnect");
    }

    // Fires when the controller connection comes up (or drops). Same treatment
    // as source reconnect — nothing to invalidate here since dedup was removed;
    // the next heartbeat re-drives virtual pins automatically.
    private void OnControllerConnection(string status, bool connected)
    {
        if (!connected) return;
        _ = TryPollAsync("controller reconnect");
    }

    private async Task TryPollAsync(string reason)
    {
        try
        {
            await _source.SendAsync("status");
            _logger.LogDebug("XPROBE state resync polled ({Reason})", reason);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "XProbeTranslator: status poll ({Reason}) failed — device likely offline; heartbeat will self-heal within ~3s", reason);
        }
    }

    private void OnMessage(string payload)
    {
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

        // No dedup — every event (edge or heartbeat) unconditionally re-drives
        // the controller pin. See the "HID model" comment at the top of the
        // class for the rationale. Idempotent writes at ~20 B/s total.
        byte b = (src, state) switch
        {
            ('P', '1') => ProbeAssert,
            ('P', '0') => ProbeRelease,
            ('T', '1') => ToolsetterAssert,
            ('T', '0') => ToolsetterRelease,
            _ => (byte)0,
        };
        if (b == 0) return;
        _ = SendAsync(b);
    }

    private async Task SendAsync(byte b)
    {
        // The xprobe streams heartbeats every ~100 ms, so if the CNC
        // controller is disconnected (USB unplugged, mid-reconnect) we'd
        // otherwise spew 10 stack traces per second into the log. Skip
        // silently — the heartbeat will re-drive the pin the moment the
        // controller comes back.
        if (!_controller.IsTransportOpen) return;
        try
        {
            await _controller.WriteRawAsync(new[] { b });
            // Debug-level: one line per probe/TLS edge is fine when triaging
            // but useless noise in a normal run. Bump the XProbeTranslator
            // category to Debug when you need to see it again.
            _logger.LogDebug("XPROBE -> controller 0x{Byte:X2} ({Action})",
                b, ActionLabel(b));
        }
        catch (Exception ex)
        {
            // Still warn on write failures that survive the gate above —
            // those are real (mid-write disconnect race, transport
            // fault) and worth logging.
            _logger.LogWarning(ex, "XProbeTranslator: failed to write byte 0x{Byte:X2} to controller", b);
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
