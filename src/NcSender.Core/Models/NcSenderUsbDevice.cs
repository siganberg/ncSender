namespace NcSender.Core.Models;

/// <summary>
/// A USB serial device whose vendor+product ids match a known ncSender
/// accessory. Produced by <c>INcSenderUsbCatalog</c>. Consumers filter
/// by <see cref="Kind"/> instead of probing arbitrary ports.
/// </summary>
public sealed record NcSenderUsbDevice(
    string PortName,             // /dev/tty.usbmodemXXX, COM7, /dev/ttyACM0
    NcSenderUsbKind Kind,        // Resolved from VID/PID pair
    ushort Vid,
    ushort Pid,
    string? SerialNumber,        // iSerialNumber if the OS exposed it
    string? ProductString);      // iProduct if the OS exposed it

/// <summary>
/// The accessory family a USB descriptor pair identifies. New PIDs get
/// a new entry here plus a row in <c>NcSenderUsbCatalog.KnownPids</c>.
/// </summary>
public enum NcSenderUsbKind
{
    Unknown = 0,
    XProbe = 1,          // 0x303A / 0x8210
    WirelessDongle = 2,  // 0x303A / 0x8211  (reserved — firmware not shipped)
    Pendant = 3,         // 0x303A / 0x8212  (reserved — firmware not shipped)
    AutoDustBoot = 4,    // 0x303A / 0x8213  (reserved — firmware not shipped)
    RgbController = 5,   // 0x303A / 0x8214  (reserved — firmware not shipped)
}
