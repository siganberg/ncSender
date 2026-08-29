using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

/// <summary>
/// Generic bridge for "addressed" ESP-NOW devices reachable through the dongle. The dongle
/// relays each paired device's traffic to the host prefixed with "@&lt;name&gt; ". Core only
/// tracks presence and relays raw payloads — it does not interpret them. Accessory plugins
/// (e.g. AutoDustBoot) own the payload semantics via the REST/WS/ctx.dongle surface.
/// </summary>
public interface IDongleDeviceService
{
    /// <summary>Snapshot of every device seen this session.</summary>
    IReadOnlyList<DongleDeviceInfo> GetDevices();

    /// <summary>Snapshot of a single device, or null if never seen.</summary>
    DongleDeviceInfo? GetDevice(string name);

    /// <summary>
    /// Feed a raw dongle line that starts with "@name …". Non-addressed lines are ignored.
    /// Called by the pendant/dongle transport.
    /// </summary>
    void OnDongleLine(string line);

    /// <summary>Wire up the transport used to write "@name payload" back to the dongle.</summary>
    void SetSender(Func<string, Task>? sender);

    /// <summary>Send a raw payload to a named device (framed as "@name payload").</summary>
    Task SendAsync(string name, string payload);

    /// <summary>
    /// Send a raw dongle line verbatim (no "@name " wrapping). Used for
    /// commands the dongle firmware itself parses — $PAIR, $UNPAIR, $OTA:*,
    /// etc. — where wrapping would defeat the dongle's own line parser.
    /// </summary>
    Task SendRawLineAsync(string line);

    /// <summary>Open the dongle's pairing window ("$PAIR") so a new device can join (~30s).</summary>
    Task OpenPairingAsync();

    Task CancelPairingAsync();

    /// <summary>Forget a paired device on the dongle ("$UNPAIR &lt;name&gt;") and drop it locally.</summary>
    Task UnpairAsync(string name);

    /// <summary>
    /// Ask the dongle for its current paired-devices list ("$DEVICES"). Reply arrives async
    /// on the same serial channel and is fed back through <see cref="OnDongleLine"/>. Used on
    /// dongle attach to seed the paired-device table from the dongle's NVS, so the plugin can
    /// tell a paired-but-offline device apart from an unpaired one after a server restart.
    /// </summary>
    Task RequestDevicesAsync();

    /// <summary>
    /// Forget every device. The paired list belongs to the dongle's NVS, not to
    /// this process, so swapping in different hardware invalidates all of it.
    /// Call before re-seeding from a newly attached dongle.
    /// </summary>
    void Reset();

    /// <summary>
    /// True once a dongle has answered a $DEVICES query with its terminating
    /// "$DEVICES:END". Distinguishes "this dongle has no peers" from "we never
    /// got an answer" — a count alone cannot.
    /// </summary>
    bool DevicesEnumerated { get; }

    /// <summary>
    /// Fires (name, payload) for every "@name payload" line received, un-throttled — used
    /// by consumers that need per-message latency (e.g. translating a wireless input to a
    /// realtime byte). The generic WebSocket relay is throttled ~1/sec and is unsuitable
    /// for that path.
    /// </summary>
    event Action<string, string>? DeviceMessageReceived;

    /// <summary>
    /// Fires (name, connected) on every connect/disconnect edge for a peer — same instants
    /// where the generic WebSocket relay emits "dongle:device-changed". Consumers that need
    /// to re-poll state on reconnect (so a stale host-side cache converges) subscribe here.
    /// </summary>
    event Action<string, bool>? DeviceConnectivityChanged;
}
