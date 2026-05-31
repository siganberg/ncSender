using System.Text.RegularExpressions;

namespace NcSender.Server.Infrastructure;

/// <summary>
/// Decides whether a USB-serial port's manufacturer string belongs to a
/// known CNC controller / USB-UART bridge. Used by Auto-Detect: when the
/// user hasn't picked a specific port, auto-connect filters the
/// enumerated ports through this list and picks the first match instead
/// of probing every port one by one.
///
/// Patterns are simple glob with '*' as the only wildcard, matched
/// case-insensitively against the manufacturer string returned by
/// SystemEndpoints.GetSerialPortManufacturer. Add more entries as new
/// boards show up — they don't conflict because the first match wins
/// and unmatched ports are simply ignored.
/// </summary>
public static class CncManufacturerWhitelist
{
    private static readonly Regex[] Patterns =
    [
        WildcardToRegex("*STMicroelectronics*STM32*"),
        WildcardToRegex("*Silicon Labs*CP210*"),
        WildcardToRegex("*Raspberry Pi*Pico*"),
        WildcardToRegex("*FTDI*"),
        WildcardToRegex("*WCH*CH34*"),
        WildcardToRegex("*CH340*"),
        WildcardToRegex("*CH9102*"),
        // ESP32 / Espressif intentionally excluded: the pendant dongle is
        // also an ESP32 with native USB, so matching here would race the
        // pendant scanner for the same port. FluidNC controllers that go
        // through a CP210x or CH340 USB-UART bridge (e.g. PiBot) still
        // match via the bridge chip's manufacturer string.
        WildcardToRegex("*Arduino*"),
        WildcardToRegex("*SparkFun*"),
    ];

    public static bool Matches(string? manufacturer)
    {
        if (string.IsNullOrEmpty(manufacturer)) return false;
        foreach (var pattern in Patterns)
        {
            if (pattern.IsMatch(manufacturer)) return true;
        }
        return false;
    }

    private static Regex WildcardToRegex(string pattern)
    {
        var escaped = Regex.Escape(pattern).Replace("\\*", ".*");
        return new Regex($"^{escaped}$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    }
}
