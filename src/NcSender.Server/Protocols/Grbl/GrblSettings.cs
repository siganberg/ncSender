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
        // The description goes where grblHAL's $ESH puts it (HalDetails[4]),
        // which is what the Firmware tab shows under the name.
        void Add(int id, FirmwareSettingGroup g, string name, int type, string description, string? unit = null, string? format = null, string? min = null, string? max = null) =>
            d[id] = new FirmwareSetting
            {
                Id = id, GroupId = g.Id, Group = g, Name = name, DataType = type, Unit = unit, Format = format, Min = min, Max = max,
                HalDetails = [id.ToString(), g.Name, "", "", description, "", "", "0", "0"]
            };

        Add(0, Stepper, "Step pulse time", Int,
            "Length of each step pulse sent to the stepper drivers. Keep it as short as your drivers accept; 10 suits most drivers.",
            "microseconds", min: "3");
        Add(1, Stepper, "Step idle delay", Int,
            "How long the motors stay powered after a move ends. 255 keeps them powered all the time so the axes hold position; most machines use 255.",
            "milliseconds", max: "255");
        Add(2, Stepper, "Step pulse invert", Bits,
            "Inverts the step signal for the selected axes. Only needed for drivers that expect an inverted step pulse; normally all off.",
            format: AxisBits);
        Add(3, Stepper, "Step direction invert", Bits,
            "Reverses the direction of the selected axes. Use it when an axis moves the opposite way to what you command: X+ should move right, Y+ away from you, Z+ up.",
            format: AxisBits);
        Add(4, Stepper, "Invert step enable pin", Bool,
            "Inverts the driver enable signal. Only for drivers that are enabled by a high signal; the controller may need a power cycle after changing it.");
        Add(5, Limits, "Invert limit pins", Bool,
            "Inverts the limit switch inputs. Off is for normally-open switches; turn it on for normally-closed switches. The controller may need a power cycle after changing it.");
        Add(6, General, "Invert probe pin", Bool,
            "Inverts the probe input. Turn it on if the probe reads as triggered when nothing is touching it.");
        Add(10, General, "Status report options", Bits,
            "What the controller includes in its position reports. With machine position on it reports machine coordinates, otherwise work coordinates; ncSender works with either. Buffer state shows planner and serial buffer use.",
            format: "Machine position,Buffer state");
        Add(11, General, "Junction deviation", Float,
            "How fast the machine takes corners. Higher values corner faster but can lose steps; lower values slow down at corners. 0.010 to 0.020 suits most machines.",
            "mm");
        Add(12, General, "Arc tolerance", Float,
            "How closely arcs (G2/G3) are followed when they are broken into short lines. The default 0.002 rarely needs changing.",
            "mm");
        Add(13, General, "Report in inches", Bool,
            "Reports positions, offsets and feed in inches instead of mm. ncSender converts either way, so the DRO is right with it on or off; to work in inches, switch units in ncSender.");
        Add(20, Limits, "Soft limits enable", Bool,
            "Rejects any move that would go past the machine's travel ($130-$132). Needs homing enabled and correct travel settings, and the machine homed so its position is known.");
        Add(21, Limits, "Hard limits enable", Bool,
            "Stops the machine immediately when a limit switch is hit, and raises an alarm. Needs limit switches wired; electrical noise on the switch wires can cause false triggers.");
        Add(22, Homing, "Homing cycle enable", Bool,
            "Enables homing ($H), which finds the switches to set machine zero. When on, the controller starts locked in an alarm until you home or unlock it.");
        Add(23, Homing, "Homing direction invert", Bits,
            "Homing moves toward the positive end of each axis by default. Turn an axis on to home it toward its negative end instead.",
            format: AxisBits);
        Add(24, Homing, "Homing locate feed rate", Float,
            "The slow speed used to touch the switch precisely once it has been found. Slower is more repeatable.",
            "mm/min");
        Add(25, Homing, "Homing search seek rate", Float,
            "The fast speed used to find the switches. Fast enough to be quick, slow enough not to crash into them.",
            "mm/min");
        Add(26, Homing, "Homing switch debounce delay", Int,
            "Time to let a switch signal settle after it triggers. 5 to 25 ms suits most switches.",
            "milliseconds");
        Add(27, Homing, "Homing switch pull-off distance", Float,
            "How far each axis backs off the switch after homing. It must clear the switch, or the next move triggers the hard limit.",
            "mm");
        Add(30, Spindle, "Maximum spindle speed", Float,
            "The spindle speed reached at full PWM output. Set it to your spindle's maximum RPM so S values match the real speed.",
            "RPM");
        Add(31, Spindle, "Minimum spindle speed", Float,
            "The spindle speed at the lowest PWM output. Any S value below it runs at this speed; S0 still turns the spindle off.",
            "RPM");
        Add(32, Spindle, "Laser mode", Bool,
            "For laser cutters: moves keep going while the power (S) changes, instead of stopping for each spindle speed change. Keep it off on a router or mill.");

        // $100-$105 steps, $110 rate, $120 acceleration, $130 travel. Stock Grbl
        // has X, Y and Z; forks with more axes continue the same numbering.
        const string letters = "XYZABC";
        for (var i = 0; i < letters.Length; i++)
        {
            var axis = letters[i];
            Add(100 + i, Axes, $"{axis}-axis travel resolution", Float,
                $"Motor steps for 1 mm of {axis} travel: steps per motor revolution x microstepping / mm per revolution. If {axis} moves the wrong distance, this is the setting to correct.",
                "step/mm");
            Add(110 + i, Axes, $"{axis}-axis maximum rate", Float,
                $"Top speed of {axis}, also used for rapids (G0). Set it 10-20% below the speed where the motor stalls.",
                "mm/min");
            Add(120 + i, Axes, $"{axis}-axis acceleration", Float,
                $"How quickly {axis} speeds up and slows down. Higher is snappier but can lose steps; set it 10-20% below where the motor stalls.",
                "mm/sec^2");
            Add(130 + i, Axes, $"{axis}-axis maximum travel", Float,
                $"Usable travel of {axis} from home, as a positive number. Used by soft limits, and by ncSender to size held jogs and the visualizer.",
                "mm");
        }
        return d;
    }
}
