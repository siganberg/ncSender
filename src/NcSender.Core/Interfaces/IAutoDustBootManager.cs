using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

/// <summary>
/// Tracks the "autodustboot" ESP-NOW device that pairs through the pendant dongle.
/// The dongle serial reader (PendantManager) forwards "@autodustboot …" lines here.
/// </summary>
public interface IAutoDustBootManager
{
    /// <summary>Current device status snapshot.</summary>
    AutoDustBootStatus GetStatus();

    /// <summary>Feed a raw dongle line beginning with '@' (from the pendant/dongle serial reader).</summary>
    void OnDongleLine(string line);

    /// <summary>Register the delegate used to send a raw line out over the dongle serial.</summary>
    void SetSender(Func<string, Task>? sender);

    /// <summary>Send a command to the device — sent as "@autodustboot &lt;payload&gt;".</summary>
    Task SendCommandAsync(string payload);
}
