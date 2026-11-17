namespace NcSender.Core.Models;

public static class ToolTypes
{
    public const string Probe = "probe";
    public const string DragKnife = "drag-knife";
    public const string Pen = "pen";

    public static readonly string[] All =
        ["flat", "ball", "v-bit", "drill", "chamfer", "surfacing", Probe, "thread-mill", DragKnife, Pen];

    // Tools the spindle must never turn: M3/M4 is refused while one is loaded.
    private static readonly string[] NonSpinning = [Probe, DragKnife, Pen];

    public static bool NeverSpins(string? type) =>
        type is not null && NonSpinning.Contains(type, StringComparer.OrdinalIgnoreCase);

    public static string Label(string type) => type.ToLowerInvariant() switch
    {
        Probe => "probe",
        DragKnife => "drag knife",
        Pen => "pen",
        _ => type,
    };
}
