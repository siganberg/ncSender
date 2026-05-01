using System.Text.RegularExpressions;
using NcSender.Core.Constants;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Protocols.GrblHal;

public partial class GrblHalProtocol : IProtocolHandler
{
    [GeneratedRegex(@"^P(\d+)")]
    private static partial Regex PinNumberPattern();

    public string Name => "grblHAL";
    public string CacheKey => "grblhal";
    public byte? FullStatusRequestByte => 0x87;
    public string AlarmFetchCommand => "$EA";
    public string? ErrorFetchCommand => "$EE";

    public bool MatchesGreeting(string line)
    {
        // Canonical Grbl ready greeting: "Grbl X.Y... '$' for help" or
        // "GrblHAL X.Y... '$' or '$HELP' for help". Excludes FluidNC, which
        // also starts with "Grbl" in its greeting line.
        var trimmed = line.TrimStart();
        return trimmed.StartsWith("Grbl", StringComparison.OrdinalIgnoreCase)
            && trimmed.Contains("for help", StringComparison.OrdinalIgnoreCase)
            && !trimmed.Contains("FluidNC", StringComparison.OrdinalIgnoreCase);
    }

    public string[] GetInitCommands()
        => ["$G", "$#=_tool_offset", "$I", "$pinstate", "$#"];

    public (string Id, string Description)? ParseAlarmLine(string line)
    {
        // grblHAL format: [ALARMCODE:N||description]
        if (!line.StartsWith("[ALARMCODE:"))
            return null;

        var inner = line.TrimStart('[').TrimEnd(']');
        var parts = inner["ALARMCODE:".Length..].Split("||", 2);
        if (parts.Length == 2)
            return (parts[0].Trim(), parts[1].Trim());

        return null;
    }

    public (string Id, string Description)? ParseErrorLine(string line)
    {
        // grblHAL format: [ERRORCODE:N||description]
        if (!line.StartsWith("[ERRORCODE:"))
            return null;

        var inner = line.TrimStart('[').TrimEnd(']');
        var parts = inner["ERRORCODE:".Length..].Split("||", 2);
        if (parts.Length == 2)
        {
            var desc = parts[1].Trim();
            if (desc.Length > 0)
                return (parts[0].Trim(), desc);
        }

        return null;
    }

    public string NormalizePinState(string pn, int activeProbe, int tlsIndex = 0, int probeCount = 0)
    {
        if (!pn.Contains('P'))
            return pn;

        // P:0 = probe → keep P
        // P:1 = TLS   → replace P with T
        // No P: field (activeProbe = -1) → add T alongside P (both LEDs for single-probe firmware)
        if (activeProbe == 1)
            return pn.Replace("P", "T");
        if (activeProbe == -1)
            return pn + "T";

        return pn;
    }

    public bool TryHandleData(string line, MachineState state, out bool stateChanged)
    {
        stateChanged = false;

        if (line.StartsWith("[PARAM:") && line.EndsWith(']'))
        {
            ParseParam(line, state, ref stateChanged);
            return true;
        }

        if (line.StartsWith("[AXS:") && line.EndsWith(']'))
        {
            ParseAxes(line, state, ref stateChanged);
            return true;
        }

        if (line.StartsWith("[AUX IO:") && line.EndsWith(']'))
        {
            ParseAuxIO(line, state, ref stateChanged);
            return true;
        }

        if (line.StartsWith("[PINSTATE:DOUT|") && line.EndsWith(']'))
        {
            ParsePinState(line, state, ref stateChanged);
            return true;
        }

        if (line.StartsWith("[NEWOPT:") && line.EndsWith(']'))
        {
            ParseNewOpt(line, state, ref stateChanged);
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

        var codePart = line.Split(':')[1];
        if (int.TryParse(codePart, out var code))
        {
            errorCode = code;
            errorMessage = GrblErrors.GetMessage(code);
            return true;
        }

        return false;
    }

    private static void ParseParam(string data, MachineState state, ref bool changed)
    {
        var content = data[7..^1];
        if (content.StartsWith("_TOOL_OFFSET="))
        {
            var value = content[13..];
            var toolLengthSet = value == "1";
            if (state.ToolLengthSet != toolLengthSet)
            {
                state.ToolLengthSet = toolLengthSet;
                changed = true;
            }
        }
    }

    private static void ParseAxes(string data, MachineState state, ref bool changed)
    {
        var match = Regex.Match(data, @"^\[AXS:(\d+):([A-Z]+)\]$");
        if (!match.Success) return;

        var axisCount = int.Parse(match.Groups[1].Value);
        var axes = match.Groups[2].Value;

        if (state.Axes != axes || state.AxisCount != axisCount)
        {
            state.Axes = axes;
            state.AxisCount = axisCount;
            changed = true;
        }
    }

    private static void ParseAuxIO(string data, MachineState state, ref bool changed)
    {
        var content = data[8..^1];
        var parts = content.Split(',');
        if (parts.Length < 2) return;
        if (!int.TryParse(parts[1], out var outputPins)) return;

        if (state.OutputPins != outputPins)
        {
            state.OutputPins = outputPins;
            changed = true;
        }
    }

    private static void ParseNewOpt(string data, MachineState state, ref bool changed)
    {
        // [NEWOPT:ENUMS,RT+,HOME,PROBES=3,ES,EXPR,TC,SED]
        var content = data[8..^1]; // strip [NEWOPT: and ]
        foreach (var part in content.Split(','))
        {
            if (part.StartsWith("PROBES=", StringComparison.OrdinalIgnoreCase) && state.ProbeCount != 2)
            {
                state.ProbeCount = 2;
                changed = true;
            }
        }
    }

    private static void ParsePinState(string data, MachineState state, ref bool changed)
    {
        var content = data[15..^1];
        var parts = content.Split('|');
        if (parts.Length < 2) return;

        var name = parts[0];
        if (!int.TryParse(parts[^1], out var value)) return;

        var pinMatch = PinNumberPattern().Match(name);
        if (!pinMatch.Success) return;

        var pinNumber = int.Parse(pinMatch.Groups[1].Value);
        var isOn = value == 1;
        var currentlyOn = state.OutputPinsState.Contains(pinNumber);

        if (isOn && !currentlyOn)
        {
            state.OutputPinsState = [.. state.OutputPinsState, pinNumber];
            state.OutputPinsState.Sort();
            changed = true;
        }
        else if (!isOn && currentlyOn)
        {
            state.OutputPinsState = state.OutputPinsState.Where(p => p != pinNumber).ToList();
            changed = true;
        }
    }
}
