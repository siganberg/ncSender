using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

/// <summary>
/// Enumerates USB serial devices whose descriptors match a known ncSender
/// accessory VID+PID. Consumers (XProbe scanner, pendant discovery, dongle
/// discovery) filter by <see cref="NcSenderUsbDevice.Kind"/> instead of
/// opening every unclaimed port and probing with <c>$ID</c> — which resets
/// Arduino-class devices and briefly locks ports on Windows.
///
/// Results are read from OS USB metadata (sysfs on Linux, system_profiler
/// on macOS, SetupAPI on Windows). No device is opened; no bytes are sent.
/// Backed by a short in-memory cache so a scan loop calling this every tick
/// doesn't hammer the underlying OS interface.
/// </summary>
public interface INcSenderUsbCatalog
{
    /// <summary>
    /// Currently visible ncSender-branded USB serial devices. Empty on any
    /// unsupported OS or enumeration failure — never throws; consumers
    /// simply find nothing.
    /// </summary>
    IReadOnlyList<NcSenderUsbDevice> GetDevices();
}
