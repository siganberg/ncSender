using System.Globalization;
using System.Text.RegularExpressions;
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

    // Per-status-poll multiplier for the M5 measured-RPM coast-down, and the rpm
    // below which the gauge snaps to 0. At ~200ms polls, 0.6 drains ~6000 rpm to
    // 0 in roughly 2s — a natural friction-like spin-down.
    private const double SpindleCoastDownFactor = 0.6;
    private const double SpindleCoastDownFloorRpm = 50;

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

        // When the spindle is commanded off (M5 → FS commanded speed 0), drain the
        // measured gauge to 0 gradually instead of snapping. FluidNC's real VFD
        // coast-down readings stop early (polling ceases once it "gives up"),
        // which is why the gauge used to stick — so we decay on each status poll
        // (~200ms). The exponential shape mirrors friction-driven spin-down; the
        // floor snaps the last sliver to 0 so it doesn't crawl. The commanded
        // speed (FS) is the reliable off signal — it reaches 0 on M5 when the
        // spindle is configured with s0_with_disable. (The A:/SpindleActive field
        // is not emitted reliably by all FluidNC builds, so we don't use it.)
        if (state.SpindleRpmTarget <= 0 && state.SpindleRpmActual > 0)
        {
            var drained = state.SpindleRpmActual * SpindleCoastDownFactor;
            state.SpindleRpmActual = drained < SpindleCoastDownFloorRpm ? 0 : Math.Round(drained);
        }

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

        // FluidNC status reports omit WCO. Synthesize it from the active
        // workspace's offset plus the current G92 modal offset and TLO so
        // the client sees the same fields grblHAL provides. The visualizer
        // and any wPos arithmetic depend on WCO matching the controller's
        // internal frame; without this every multi-workspace render is
        // misaligned by the difference between G54 and the file's frame.
        SynthesizeWco(state);
    }

    private static void SynthesizeWco(MachineState state)
    {
        var activeOffset = state.Workspace switch
        {
            "G54" => state.G54,
            "G55" => state.G55,
            "G56" => state.G56,
            "G57" => state.G57,
            "G58" => state.G58,
            "G59" => state.G59,
            _ => null
        };

        if (string.IsNullOrEmpty(activeOffset)) return;

        var activeParts = activeOffset.Split(',');
        var g92Parts = state.G92Offset?.Split(',');
        var tlo = state.Tlo;

        var len = activeParts.Length;
        var wco = new string[len];
        for (var i = 0; i < len; i++)
        {
            if (!double.TryParse(activeParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var a))
            {
                wco[i] = "0.000";
                continue;
            }

            var g92 = 0.0;
            if (g92Parts is not null && i < g92Parts.Length)
                double.TryParse(g92Parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out g92);

            // TLO is Z-only on FluidNC
            var tloComponent = i == 2 ? tlo : 0.0;

            wco[i] = (a + g92 + tloComponent).ToString("F3", CultureInfo.InvariantCulture);
        }

        state.WCO = string.Join(",", wco);
    }

    public string NormalizePinState(string pn, int activeProbe, int tlsIndex = 0, int probeCount = 0)
    {
        // FluidNC reports Pn:P (probe) and Pn:T (TLS) natively — no normalization needed
        return pn;
    }

    // FluidNC has no measured-RPM field in its status report (FS is only
    // "feedrate,commanded_speed"). For VFD spindles it instead streams the VFD's
    // live measured RPM as "[MSG:INFO: Current speed is N]" while the speed is
    // changing — the ramp up, the ramp down, and down to 0 on M5. That N is true
    // measured rpm (e.g. H100 get_rpm reads output frequency), so we use it to
    // drive the actual-RPM gauge.
    //
    // Its sibling logs "Syncing to N" / "Synced speed to N" report raw DEVICE
    // units (Hz-based), not rpm, so they must NOT feed the gauge — they only get
    // consumed to keep them out of the terminal.
    //
    // Notes: these logs require the spindle's `debug` option >= 2 (the default),
    // and ModbusVFD does no steady-state speed polling (safety_polling=false), so
    // between speed changes the last measured value is held rather than tracked.
    private static readonly Regex VfdMeasuredSpeedPattern =
        new(@"\[MSG:INFO:\s*Current speed is\s+(\d+)\s*\]",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SpindleSyncMessagePattern =
        new(@"\[MSG:INFO:\s*(?:Syncing to|Current speed is|Synced speed to)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public bool TryHandleData(string line, MachineState state, out bool stateChanged)
    {
        stateChanged = false;

        var measured = VfdMeasuredSpeedPattern.Match(line);
        if (measured.Success)
        {
            // Only track measured RPM while the spindle is commanded on. After M5
            // the VFD emits a few coast-down readings before polling stops;
            // ignoring them keeps the gauge from flickering off 0 (which
            // PostProcessStatus also enforces on the next status report).
            if (state.SpindleRpmTarget > 0
                && double.TryParse(measured.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var rpm)
                && state.SpindleRpmActual != rpm)
            {
                state.SpindleRpmActual = rpm;
                stateChanged = true;
            }
            return true;
        }

        // "Syncing to N" / "Synced speed to N" — device units, consume only so
        // they don't reach the terminal.
        return SpindleSyncMessagePattern.IsMatch(line);
    }

    public bool ShouldSuppressEcho(string line)
        => SpindleSyncMessagePattern.IsMatch(line);

    // Match G54-G59 (workspace change) or M2/M30 (end-of-program reset) as
    // standalone tokens. Carveco-style files emit compound lines like
    // "G90 G94 G55" — an exact-match check misses those. M30 also resets
    // modal state (workspace back to G54) on program end, and FluidNC's
    // status report can't tell us either change. The optional zero padding
    // (M0*2 / M0*30) accepts forms like M02 or M030. Word boundaries
    // prevent false matches on G540, M200, etc.
    private static readonly Regex StateRefreshPattern =
        new(@"\b(G5[4-9]|M0*30|M0*2)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public bool NeedsGCodeStateRefresh(string command)
        => StateRefreshPattern.IsMatch(command);

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
