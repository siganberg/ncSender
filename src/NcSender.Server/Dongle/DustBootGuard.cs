namespace NcSender.Server.Dongle;

/// <summary>
/// No AutoDustBoot expand during a tool change: the spindle is at the rack, and
/// a boot lowered there by hand (the visualizer toggle, the pendant, the
/// plugin's jog buttons) hits it. Moves toward home stay allowed.
/// </summary>
public static class DustBootGuard
{
    public const string Device = "autodustboot";

    // Within 0.3 mm of home (505.7 counts/mm) counts as retracted.
    private static readonly long RetractedCounts = (long)Math.Round(0.3 * 505.7);

    /// <summary>True for a boot command that moves it toward expanded.</summary>
    public static bool IsExpand(string payload)
    {
        var p = payload.Trim().ToLowerInvariant();
        if (p is "down" or "stepdown") return true;   // the boot's +1 direction
        return p.StartsWith("goto:", StringComparison.Ordinal)
            && long.TryParse(p.AsSpan(5), out var target) && target > RetractedCounts;
    }

    public static bool Blocks(string device, string payload, bool toolChanging) =>
        toolChanging && string.Equals(device, Device, StringComparison.OrdinalIgnoreCase) && IsExpand(payload);
}
