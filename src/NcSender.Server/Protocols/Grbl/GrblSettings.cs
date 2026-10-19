using NcSender.Core.Models;

namespace NcSender.Server.Protocols.Grbl;

/// <summary>
/// Grbl 1.1's fixed settings list. Grbl can't describe its settings ($ES), so
/// the Firmware tab gets names, units and controls from here. Data types use
/// grblHAL's codes: 0 bool, 2 named bitfield, 5 integer, 6 float.
/// </summary>
internal static class GrblSettings
{
    private const int Bool = 0, Bits = 2, Int = 5, Float = 6;
    private const string AxisBits = "X,Y,Z";

    private static readonly FirmwareSettingGroup General = new() { Id = 1, Name = "General" };
    private static readonly FirmwareSettingGroup Stepper = new() { Id = 2, Name = "Stepper" };
    private static readonly FirmwareSettingGroup Limits = new() { Id = 3, Name = "Limits" };
    private static readonly FirmwareSettingGroup Homing = new() { Id = 4, Name = "Homing" };
    private static readonly FirmwareSettingGroup Spindle = new() { Id = 5, Name = "Spindle" };
    private static readonly FirmwareSettingGroup Axes = new() { Id = 6, Name = "Axes" };

    public static IReadOnlyDictionary<int, FirmwareSetting> Definitions { get; } = Build();

    private static Dictionary<int, FirmwareSetting> Build()
    {
        var d = new Dictionary<int, FirmwareSetting>();
        void Add(int id, FirmwareSettingGroup g, string name, int type, string? unit = null, string? format = null, string? min = null, string? max = null) =>
            d[id] = new FirmwareSetting { Id = id, GroupId = g.Id, Group = g, Name = name, DataType = type, Unit = unit, Format = format, Min = min, Max = max };

        Add(0, Stepper, "Step pulse time", Int, "microseconds", min: "3");
        Add(1, Stepper, "Step idle delay (255 = keep motors on)", Int, "milliseconds", max: "255");
        Add(2, Stepper, "Step pulse invert", Bits, format: AxisBits);
        Add(3, Stepper, "Step direction invert", Bits, format: AxisBits);
        Add(4, Stepper, "Invert step enable pin", Bool);
        Add(5, Limits, "Invert limit pins", Bool);
        Add(6, General, "Invert probe pin", Bool);
        Add(10, General, "Status report options", Bits, format: "Position in machine coordinates,Buffer state");
        Add(11, General, "Junction deviation", Float, "mm");
        Add(12, General, "Arc tolerance", Float, "mm");
        Add(13, General, "Report in inches", Bool);
        Add(20, Limits, "Soft limits enable", Bool);
        Add(21, Limits, "Hard limits enable", Bool);
        Add(22, Homing, "Homing cycle enable", Bool);
        Add(23, Homing, "Homing direction invert", Bits, format: AxisBits);
        Add(24, Homing, "Homing locate feed rate", Float, "mm/min");
        Add(25, Homing, "Homing search seek rate", Float, "mm/min");
        Add(26, Homing, "Homing switch debounce delay", Int, "milliseconds");
        Add(27, Homing, "Homing switch pull-off distance", Float, "mm");
        Add(30, Spindle, "Maximum spindle speed", Float, "RPM");
        Add(31, Spindle, "Minimum spindle speed", Float, "RPM");
        Add(32, Spindle, "Laser mode", Bool);

        // $100-$105 steps, $110 rate, $120 acceleration, $130 travel. Stock Grbl
        // has X, Y and Z; forks with more axes continue the same numbering.
        const string letters = "XYZABC";
        for (var i = 0; i < letters.Length; i++)
        {
            var axis = letters[i];
            Add(100 + i, Axes, $"{axis}-axis travel resolution", Float, "step/mm");
            Add(110 + i, Axes, $"{axis}-axis maximum rate", Float, "mm/min");
            Add(120 + i, Axes, $"{axis}-axis acceleration", Float, "mm/sec^2");
            Add(130 + i, Axes, $"{axis}-axis maximum travel", Float, "mm");
        }
        return d;
    }
}
