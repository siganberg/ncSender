namespace NcSender.Core.Interfaces;

/// <summary>
/// Single abstract source of <c>@xprobe</c> payloads for the XProbeTranslator.
///
/// The physical xprobe device is reachable two ways: wirelessly through the
/// ESP-NOW dongle (via <see cref="IDongleDeviceService"/>) or wired via USB
/// serial straight into the host. This interface lets the translator subscribe
/// to whichever source is currently authoritative without knowing which it is;
/// priority arbitration (wired wins when connected) lives inside the router.
///
/// Payloads carry the same <c>&lt;state&gt;:&lt;type&gt;:&lt;seq&gt;:&lt;src&gt;</c>
/// grammar in both cases — the framing tag is stripped before it reaches here.
/// </summary>
public interface IXProbeSource
{
    /// <summary>
    /// True while the wired (USB) source is present and considered
    /// authoritative. Wireless events are still visible for connectivity /
    /// diagnostics but must not influence the controller state when this is
    /// true — the router already suppresses them.
    /// </summary>
    bool UsbActive { get; }

    /// <summary>
    /// Fires for every payload the router has selected — from USB when
    /// <see cref="UsbActive"/> is true, from wireless otherwise. Payload is
    /// the raw <c>&lt;state&gt;:&lt;type&gt;:&lt;seq&gt;:&lt;src&gt;</c> string with
    /// no framing tag.
    /// </summary>
    event Action<string>? MessageReceived;

    /// <summary>
    /// Fires (connected) on transitions of the currently-selected transport.
    /// Consumers use this to reset per-channel dedup so a reconnect always
    /// re-drives the controller to the sensor's actual state.
    /// </summary>
    event Action<bool>? ConnectivityChanged;

    /// <summary>
    /// Send a command back to the xprobe device on whatever transport is
    /// currently active. Used for the "status" poll on reconnect. No-op if
    /// nothing is connected; caller should be resilient to that (heartbeat
    /// will re-emit state within a few seconds anyway).
    /// </summary>
    Task SendAsync(string command);
}
