using System.Text.RegularExpressions;
using NcSender.Core.Constants;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Protocols.Grbl;

/// <summary>
/// Classic Grbl 1.1 (Arduino boards, Carbide Motion's Shapeoko/Nomad firmware).
/// It reports less than grblHAL (no H:, WCS: or T: fields, no $EA/$EE lists),
/// and everything it can't run is handled by <see cref="GrblTranslator"/>.
/// </summary>
public partial class GrblProtocol : IProtocolHandler
{
    public string Name => "Grbl";
    public string CacheKey => "grbl";

    // Grbl has no $EA; descriptions come from StaticAlarmDescriptions.
    public string AlarmFetchCommand => "";

    // "Grbl 1.1h ['$' for help]". grblHAL says "['$' or '$HELP' for help]",
    // FluidNC "[FluidNC v3.x ... '$' for help]".
    [GeneratedRegex(@"^Grbl\s+\d+\.\d+[a-z]?\s*\[\s*'\$'\s+for\s+help\s*\]\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex GreetingPattern();

    public bool MatchesGreeting(string line) => GreetingPattern().IsMatch(line.Trim());

    public string[] GetInitCommands() => ["$G", "$#=_tool_offset", "$I", "$#"];

    public bool SupportsSettingEnumeration => false;

    public bool SupportsOverrideControl => false;

    public IGcodeTranslator CreateTranslator(Func<MachineState> state) => new GrblTranslator(state);

    // A grblHAL build can be set to greet like classic Grbl; its $I still
    // lists [NEWOPT:...], which Grbl never sends.
    public IReadOnlyDictionary<int, FirmwareSetting> StaticSettingDefinitions => GrblSettings.Definitions;

    public string? RedirectProtocol(string line) =>
        line.StartsWith("[NEWOPT:", StringComparison.Ordinal) ? "grblhal" : null;

    public (string Id, string Description)? ParseAlarmLine(string line) => null;

    public IReadOnlyDictionary<string, string> StaticAlarmDescriptions { get; } = new Dictionary<string, string>
    {
        ["1"] = "Hard limit triggered. Machine position is likely lost due to sudden and immediate halt. Re-homing is highly recommended.",
        ["2"] = "G-code motion target exceeds machine travel. Machine position safely retained. Alarm may be unlocked.",
        ["3"] = "Reset while in motion. Grbl cannot guarantee position. Lost steps are likely. Re-homing is highly recommended.",
        ["4"] = "Probe fail. The probe is not in the expected initial state before starting probe cycle.",
        ["5"] = "Probe fail. Probe did not contact the workpiece within the programmed travel.",
        ["6"] = "Homing fail. Reset during active homing cycle.",
        ["7"] = "Homing fail. Safety door was opened during active homing cycle.",
        ["8"] = "Homing fail. Cycle failed to clear limit switch when pulling off. Try increasing pull-off setting or check wiring.",
        ["9"] = "Homing fail. Could not find limit switch within search distance. Try increasing max travel, decreasing pull-off distance, or check wiring.",
    };

    // No tool setter input on Grbl: the probe pin is the only one.
    public string NormalizePinState(string pn, int activeProbe, int tlsIndex = 0, int probeCount = 0) => pn;

    public void PostProcessStatus(MachineState state, string previousStatus)
    {
        // No H: field. A homing cycle that ends in Idle homed the machine;
        // alarms that lose position undo it (2, 4 and 5 keep it).
        if (previousStatus.StartsWith("Home", StringComparison.OrdinalIgnoreCase) && state.Status == "Idle")
            state.Homed = true;
        else if (state.Status.StartsWith("Alarm", StringComparison.OrdinalIgnoreCase)
                 && state.AlarmCode is { } code && code is not (2 or 4 or 5))
            state.Homed = false;

        // No [AXS:...]: the axes are the MPos fields.
        if (!string.IsNullOrEmpty(state.MPos))
        {
            var count = Math.Min(state.MPos.Split(',').Length, 6);
            var axes = "XYZABC"[..count];
            if (state.Axes != axes || state.AxisCount != count)
            {
                state.Axes = axes;
                state.AxisCount = count;
            }
        }
    }

    public bool TryHandleData(string line, MachineState state, out bool stateChanged)
    {
        stateChanged = false;
        // Reported by GrblTranslator for $#=_tool_offset, in grblHAL's format.
        if (line.StartsWith("[PARAM:", StringComparison.Ordinal) && line.EndsWith(']'))
        {
            GrblHal.GrblHalProtocol.ParseParam(line, state, ref stateChanged);
            return true;
        }
        return false;
    }

    public bool TryParseError(string line, out int? errorCode, out string errorMessage)
    {
        errorCode = null;
        errorMessage = "";
        if (!line.StartsWith("error:", StringComparison.OrdinalIgnoreCase))
            return false;
        if (!int.TryParse(line.Split(':')[1], out var code))
            return false;
        errorCode = code;
        errorMessage = GrblErrors.GetMessage(code);
        return true;
    }

    // Status reports carry no WCS: or T: field, so the parser state is read
    // back after anything that changes them.
    [GeneratedRegex(@"G5[4-9](?![.\d])|M0*2(?!\d)|M30|T\d", RegexOptions.IgnoreCase)]
    private static partial Regex StateChangePattern();

    public bool NeedsGCodeStateRefresh(string command) => StateChangePattern().IsMatch(command);
}
