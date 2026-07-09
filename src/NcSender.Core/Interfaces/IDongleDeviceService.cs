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

    /// <summary>Open the dongle's pairing window ("$PAIR") so a new device can join (~30s).</summary>
    Task OpenPairingAsync();

    /// <summary>Forget a paired device on the dongle ("$UNPAIR &lt;name&gt;") and drop it locally.</summary>
    Task UnpairAsync(string name);

    /// <summary>
    /// Ask the dongle for its current paired-devices list ("$DEVICES"). Reply arrives async
    /// on the same serial channel and is fed back through <see cref="OnDongleLine"/>. Used on
    /// dongle attach to seed the paired-device table from the dongle's NVS, so the plugin can
    /// tell a paired-but-offline device apart from an unpaired one after a server restart.
    /// </summary>
    Task RequestDevicesAsync();
}
