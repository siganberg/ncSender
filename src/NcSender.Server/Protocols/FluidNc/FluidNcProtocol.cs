using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Protocols.GrblHal;

namespace NcSender.Server.Protocols.FluidNc;

/// <summary>
/// FluidNC runs as grblHAL: <see cref="FluidNcTranslator"/> makes up the
/// difference in both directions (what is sent and what is reported), so the
/// rest of ncSender and the plugins only deal with grblHAL. What stays here is
/// what a translator can't change: how FluidNC is recognised and what it
/// lacks or adds as a whole (no $ES setting list, no $EE error list, its
/// config.yaml).
/// </summary>
public partial class FluidNcProtocol : GrblHalProtocol
{
    public override string Name => "FluidNC";
    public override string CacheKey => "fluidnc";

    // No 0x87 full status request.
    public override byte? FullStatusRequestByte => null;
    // No $EE error list: errors are described from the standard Grbl table.
    public override string? ErrorFetchCommand => null;
    // No $EG/$ES/$ESH: its settings are a config.yaml tree, not $ numbers.
    public override bool SupportsSettingEnumeration => false;
    public override bool SupportsConfigFile => true;

    // grblHAL keeps the current tool through a reset; FluidNC sets it to T0, so
    // the translator keeps it in this file (null: not kept, for tests).
    public string? ToolFile { get; init; } = Path.Combine(Infrastructure.PathUtils.GetUserDataDir(), "fluidnc-tool.txt");

    public override IGcodeTranslator CreateTranslator(Func<MachineState> state) => new FluidNcTranslator(ToolFile);

    public override bool MatchesGreeting(string line)
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

    public override void PostProcessStatus(MachineState state, string previousStatus)
    {
        // No [AXS:...] in $I: the axes are the MPos fields.
        if (string.IsNullOrEmpty(state.MPos)) return;
        var count = Math.Clamp(state.MPos.Split(',').Length, 3, 6);
        var axes = "XYZABC"[..count];
        if (state.Axes != axes || state.AxisCount != count)
        {
            state.Axes = axes;
            state.AxisCount = count;
        }
    }

    // The status report has no WCS: or T: field, so the parser state ([GC:]) is
    // read back after anything that changes the workspace or the tool. M2/M30
    // put the workspace back to G54. G54.1 and the like are not workspaces;
    // M600 is not M6.
    [GeneratedRegex(@"G5[4-9](?![.\d])|M0*2(?!\d)|M0*30(?!\d)|M0*61(?!\d)|M0*6(?![\d.])|T\d", RegexOptions.IgnoreCase)]
    private static partial Regex StateChangePattern();

    // Not in a comment: "(unload T1)" changes nothing.
    public override bool NeedsGCodeStateRefresh(string command) =>
        StateChangePattern().IsMatch(CommentPattern().Replace(command, ""));

    [GeneratedRegex(@"\([^)]*\)|;.*$")]
    private static partial Regex CommentPattern();
}
