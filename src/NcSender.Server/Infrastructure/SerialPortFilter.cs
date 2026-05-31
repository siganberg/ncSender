namespace NcSender.Server.Infrastructure;

/// <summary>
/// Shared rules for hiding non-CNC serial ports. Used by both auto-connect
/// (so it doesn't probe Bluetooth / debug-console / DJI etc.) and the
/// /api/usb-ports endpoint (so the connection dialog doesn't show them).
/// Path-substring match because the noisy ports on macOS — e.g.
/// /dev/cu.Bluetooth-Incoming-Port — encode their identity in the path.
/// </summary>
public static class SerialPortFilter
{
    private static readonly string[] ExcludedFragments =
    [
        "debug-console",
        "Bluetooth-Incoming-Port",
        "Bluetooth",
        "wlan-debug",
        "DJI"
    ];

    public static bool IsExcluded(string port)
    {
        if (string.IsNullOrEmpty(port)) return false;
        foreach (var fragment in ExcludedFragments)
        {
            if (port.Contains(fragment, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }
}
