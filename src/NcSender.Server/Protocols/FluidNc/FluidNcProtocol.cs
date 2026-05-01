using NcSender.Core.Constants;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Protocols.FluidNc;

public class FluidNcProtocol : IProtocolHandler
{
    public string Name => "FluidNC";
    public string CacheKey => "fluidnc";
    public byte? FullStatusRequestByte => null;
    public bool SupportsSettingEnumeration => false;
    public string AlarmFetchCommand => "$A";

    public bool MatchesGreeting(string line)
    {
        // Require the canonical Grbl ready greeting — emitted only after the
        // controller finishes booting (config dump, WiFi, mDNS). A loose
        // Contains("FluidNC") used to match the banner "[MSG:INFO: FluidNC ...]"
        // that arrives ~5s before the controller is actually ready, causing
        // AutoConnect to lock onto the port before status polling could
        // succeed and then drop the connection.
        var trimmed = line.TrimStart();
        return trimmed.StartsWith("Grbl ", StringComparison.OrdinalIgnoreCase)
            && trimmed.Contains("FluidNC", StringComparison.OrdinalIgnoreCase)
            && trimmed.Contains("for help", StringComparison.OrdinalIgnoreCase);
    }

    public string[] GetInitCommands()
        => ["$G", "$I", "$#"];

    public (string Id, string Description)? ParseAlarmLine(string line)
    {
        // FluidNC format: "N: Description" (e.g. "1: Hard Limit")
        var colonIdx = line.IndexOf(':');
        if (colonIdx > 0 && int.TryParse(line[..colonIdx].Trim(), out _))
            return (line[..colonIdx].Trim(), line[(colonIdx + 1)..].Trim());

        return null;
    }

    public void PostProcessStatus(MachineState state, string previousStatus)
    {
        // FluidNC has no H: field in status reports — always report as homed
        // so the UI doesn't gate on "homing required". Homing is up to the user.
        state.Homed = true;

        // FluidNC doesn't send [AXS:...] like grblHAL — detect axes from MPos field count
        if (!string.IsNullOrEmpty(state.MPos))
        {
            var count = state.MPos.Split(',').Length;
            var axes = count switch
            {
                >= 6 => "XYZABC",
                5 => "XYZAB",
                4 => "XYZA",
                _ => "XYZ"
            };
            axes = axes[..count];

            if (state.Axes != axes || state.AxisCount != count)
            {
                state.Axes = axes;
                state.AxisCount = count;
            }
        }
    }

    public string NormalizePinState(string pn, int activeProbe, int tlsIndex = 0, int probeCount = 0)
    {
        // FluidNC reports Pn:P (probe) and Pn:T (TLS) natively — no normalization needed
        return pn;
    }

    public bool TryHandleData(string line, MachineState state, out bool stateChanged)
    {
        stateChanged = false;
        // TODO: Handle FluidNC-specific messages
        return false;
    }

    private static readonly HashSet<string> WorkspaceCommands = new(StringComparer.OrdinalIgnoreCase)
        { "G54", "G55", "G56", "G57", "G58", "G59" };

    public bool NeedsGCodeStateRefresh(string command)
    {
        // FluidNC doesn't report WCS in status reports — need $G after workspace changes
        var trimmed = command.Trim();
        return WorkspaceCommands.Contains(trimmed);
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
}
