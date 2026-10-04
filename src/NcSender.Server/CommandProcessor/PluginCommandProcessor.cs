using System.Globalization;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Core.Utils;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.CommandProcessor;

public class PluginCommandProcessor : ICommandProcessor
{
    private readonly ICommandProcessor _inner;
    private readonly IJsPluginEngine _jsEngine;
    private readonly IToolService _toolService;
    private readonly IServerContext _serverContext;
    private readonly IToolChangeTracker? _toolChangeTracker;
    private readonly IPluginManager? _pluginManager;
    private readonly IBroadcaster _broadcaster;
    private readonly ISettingsManager _settingsManager;
    private readonly IToolProjection _toolProjection;
    private readonly ILogger<PluginCommandProcessor> _logger;

    public PluginCommandProcessor(
        ICommandProcessor inner,
        IJsPluginEngine jsEngine,
        IToolService toolService,
        IServerContext serverContext,
        IBroadcaster broadcaster,
        ISettingsManager settingsManager,
        IToolProjection toolProjection,
        ILogger<PluginCommandProcessor> logger,
        IToolChangeTracker? toolChangeTracker = null,
        IPluginManager? pluginManager = null)
    {
        _toolChangeTracker = toolChangeTracker;
        _pluginManager = pluginManager;
        _inner = inner;
        _jsEngine = jsEngine;
        _toolService = toolService;
        _serverContext = serverContext;
        _broadcaster = broadcaster;
        _settingsManager = settingsManager;
        _toolProjection = toolProjection;
        _logger = logger;
    }

    public async Task<CommandProcessorResult> ProcessAsync(string command, CommandProcessorContext context)
    {
        var pluginIds = _jsEngine.GetLoadedPluginIds();

        // --- Door-open tool change guard (runs before the early-out below so
        // it covers all sources, plugins loaded or not) ---
        //
        // Reject M6 and $TLS unconditionally when the door is open — from terminal,
        // buttons, slot press, plugin — everything EXCEPT the running-job
        // stream. grblHAL already halts a running program when the door
        // opens (Door hold), so this covers the out-of-band sources it
        // can't police. $TLS needs it as much as M6: the per-line door rules
        // drop only its G0 lines (safe Z, the move over the setter) while the
        // probe-down still runs, from wherever the spindle is. Mirrors
        // CommandProcessor.CreateBlockedResult so
        // the client's terminal renders "M6Tn (BLOCKED - door open)" with
        // an X icon immediately — no grblHAL round-trip.
        //
        // Detects Door via either the derived status ("Door") or the raw
        // Pn pin (contains 'D'), covering $61=1 setups where Status
        // stays Idle while the door pin is asserted.
        {
            var m6Check = GcodePatterns.ParseM6Command(command);
            var isValidM6Early = m6Check.Matched && m6Check.ToolNumber is not null;
            var isToolChangeEarly = isValidM6Early || GcodePatterns.IsTlsCommand(command);
            var sourceIdEarly = context.Meta?.SourceId;
            var isJobSourceEarly = sourceIdEarly is "job" or "resume";
            if (isToolChangeEarly && !isJobSourceEarly && IsDoorOpen(context.MachineState))
            {
                _logger.LogInformation("{Command} rejected — door open (source: {Source})", command.Trim(), sourceIdEarly ?? "unknown");
                return Refuse(command, context, "door open", stopsJob: false);
            }

            // An enabled plugin that should shape this change isn't running
            // (quarantined, failed to load). A job can't start in that state,
            // so only manual changes reach here.
            if (isToolChangeEarly && !isJobSourceEarly && _pluginManager?.GetMotionBlocker() is { } blocker)
            {
                _logger.LogWarning("{Command} rejected — {Reason}", command.Trim(), blocker);
                return Refuse(command, context, blocker, stopsJob: false);
            }
        }

        // No plugins — pass through to inner processor (which handles everything)
        if (pluginIds.Count == 0)
            return await _inner.ProcessAsync(command, context);

        // --- Pre-processing: detect M6/$TLS before plugin expansion (matches V1 flow) ---

        var machineState = context.MachineState;
        var m6Parse = GcodePatterns.ParseM6Command(command);
        var isValidM6 = m6Parse.Matched && m6Parse.ToolNumber is not null;
        var isTLS = GcodePatterns.IsTlsCommand(command);

        // Expansion runs ahead of execution — use the projected tool for both
        // the skip decision and the value handed to plugins, so an ATC plugin
        // builds its unload half against the tool that will actually be in
        // the spindle rather than the one that was there when the batch began.
        var currentTool = _toolProjection.EffectiveToolFor(machineState.Tool);
        context.ProjectedTool = currentTool;
        var sameToolCheck = GcodePatterns.CheckSameToolChange(command, currentTool);

        // Same-tool M6 skip — handled here so plugin never sees it
        if (sameToolCheck.IsSameTool)
        {
            return await _inner.ProcessAsync(command, context);
        }

        // Save return position for M6
        XyPosition? m6ReturnPosition = null;
        var m6UseWorkCoordinates = false;
        if (isValidM6)
        {
            var nextXY = context.NextXYPosition;
            if (nextXY is not null)
            {
                m6ReturnPosition = nextXY;
                m6UseWorkCoordinates = true;
                _logger.LogDebug("Using next XY from G-code for M6 return: X{X} Y{Y}", nextXY.X, nextXY.Y);
            }
            else
            {
                m6ReturnPosition = ParseMachinePosition(machineState.MPos);
                if (m6ReturnPosition is not null)
                    _logger.LogDebug("Saved M6 return position (MPos): X{X:F3} Y{Y:F3}",
                        m6ReturnPosition.X, m6ReturnPosition.Y);
            }
        }

        // Save return position for $TLS
        XyPosition? tlsReturnPosition = null;
        if (isTLS)
        {
            tlsReturnPosition = ParseMachinePosition(machineState.MPos);
            if (tlsReturnPosition is not null)
                _logger.LogDebug("Saved TLS return position: X{X:F3} Y{Y:F3}",
                    tlsReturnPosition.X, tlsReturnPosition.Y);
        }

        // NOTE: IsToolChanging is intentionally NOT set here. It's toggled at
        // dispatch time via the TOOL_CHANGE_START / TOOL_CHANGE_COMPLETE
        // sentinels that bracket the expansion (see below and CncEventBridge
        // OnDataReceived). Setting the flag here was wrong for macro use:
        // expansion is a synchronous batch — a macro like
        //     M6 T1 / G4 P1 / M6 T2 / G4 P1 / M6 T3
        // expands ALL body lines before ANY command is dispatched to the
        // controller. With the old expansion-time set + `!IsToolChanging`
        // guard, only M6 T1 flipped the flag; T2 and T3 saw it still true
        // (nothing had run yet, TCC hadn't fired) and skipped. Then at
        // dispatch, T1's TCC cleared the flag mid-macro and T2/T3 executed
        // with the flag false — the UI flickered Running/Idle through the
        // plugin's sub-moves. Sentinel-based toggling gets one flip per
        // actual controller-side execution, so this works for any batch shape.

        // Populate safe Z height from core app settings for plugins
        context.SafeZHeight = _settingsManager.GetSetting<double>("safeZHeight", -5);

        // --- Plugin expansion ---

        var commands = new List<ProcessedCommand>
        {
            new() { Command = command, IsOriginal = true, Meta = context.Meta }
        };

        var tools = await _toolService.GetAllAsync();
        try
        {
            commands = await RunPluginChainAsync(commands, pluginIds, context, tools);
            commands = await ExpandNestedMarkersAsync(commands, pluginIds, context, tools);
        }
        catch (NcSender.Server.Plugins.PluginCommandException ex)
        {
            // Sending the command without the plugin's lines could leave a
            // dust boot down or skip part of a tool change: refuse it, and
            // stop a running job here.
            return Refuse(command, context, ex.Message, stopsJob: true);
        }

        // If plugin didn't modify (single original command), use inner processor directly
        // Inner processor handles all its own logic (door safety, laser mode, return-to-position, etc.)
        if (commands.Count == 1 && commands[0].IsOriginal)
            return await _inner.ProcessAsync(commands[0].Command, context);

        // --- Plugin expanded: run each through inner for safety checks ---

        _logger.LogDebug("Plugin expanded {Original} into {Count} commands", command, commands.Count);

        var finalCommands = new List<ProcessedCommand>();

        // Prepend TOOL_CHANGE_START — CncEventBridge.OnDataReceived flips
        // IsToolChanging=true when the controller echoes [MSG:] for this,
        // so the header shows "Tool Changing" at the moment execution
        // actually starts (not at expansion time, which for macros is
        // completely detached from dispatch order). Paired with the
        // TOOL_CHANGE_COMPLETE sentinel appended below.
        var toolChangeId = 0;
        if (isValidM6 || isTLS)
        {
            var job = _serverContext.State.JobLoaded;
            toolChangeId = _toolChangeTracker?.Register(new ToolChangeInfo(
                isTLS ? "TLS" : "M6",
                isTLS ? currentTool : m6Parse.ToolNumber!.Value,
                currentTool,
                command.Trim(),
                context.Meta?.SourceId,
                job is not null && job.Status == "running")) ?? 0;
            finalCommands.Add(ToolChangeSentinel.Start(toolChangeId));
        }

        foreach (var cmd in commands)
        {
            var innerResult = await _inner.ProcessAsync(cmd.Command, context);
            if (innerResult.ShouldContinue)
            {
                foreach (var innerCmd in innerResult.Commands)
                {
                    // Plugin-expanded lines are noisy enough on their own —
                    // strip the "(keepout bypassed)" audit tag so the
                    // terminal only shows it for user-typed commands where
                    // the annotation is actually useful. Preserves any
                    // OTHER inner-added display info (feed-limit tags,
                    // clamp notes, etc.).
                    finalCommands.Add(new ProcessedCommand
                    {
                        Command = innerCmd.Command,
                        DisplayCommand = cmd.DisplayCommand ?? StripBypassAnnotation(innerCmd.DisplayCommand),
                        IsOriginal = cmd.IsOriginal,
                        Meta = cmd.Meta ?? innerCmd.Meta
                    });
                }
            }
            // If inner says don't continue (door blocked), skip that command
        }

        // --- Post-processing: append return-to-position + sentinel (matches V1 flow) ---

        if (isValidM6)
        {
            // Not a skipped change, so anything expanded after this line will
            // run with the new tool loaded.
            _toolProjection.ToolChangeQueued(m6Parse.ToolNumber!.Value);

            // Return-to-position only for manual invocation (not during program run)
            if (m6ReturnPosition is not null && !m6UseWorkCoordinates)
            {
                var returnCmd = string.Format(CultureInfo.InvariantCulture, "G53 G21 G0 X{0:F3} Y{1:F3}", m6ReturnPosition.X, m6ReturnPosition.Y);
                _logger.LogDebug("Adding M6 return command: {ReturnCmd}", returnCmd);
                finalCommands.Add(new ProcessedCommand
                {
                    Command = returnCmd,
                    DisplayCommand = returnCmd,
                    IsOriginal = false
                });
            }

            finalCommands.Add(ToolChangeSentinel.Sync());
            finalCommands.Add(ToolChangeSentinel.Complete(toolChangeId));
        }

        if (isTLS)
        {
            const int probeIdx = 0;
            var tlsIdx = _settingsManager.GetSetting<int>("tlsIndex", 0);

            // Switch to TLS probe source before TLS commands
            if (tlsIdx != probeIdx)
            {
                finalCommands.Insert(0, new ProcessedCommand
                {
                    Command = $"G65P5Q{tlsIdx}",
                    DisplayCommand = $"G65P5Q{tlsIdx} (switch to TLS probe source)",
                    IsOriginal = false
                });
            }

            // Restore probe source after TLS
            if (tlsIdx != probeIdx)
            {
                finalCommands.Add(new ProcessedCommand
                {
                    Command = $"G65P5Q{probeIdx}",
                    DisplayCommand = $"G65P5Q{probeIdx} (restore probe source)",
                    IsOriginal = false,
                    Cleanup = true
                });
            }

            if (tlsReturnPosition is not null)
            {
                var returnCmd = string.Format(CultureInfo.InvariantCulture, "G53 G21 G0 X{0:F3} Y{1:F3}", tlsReturnPosition.X, tlsReturnPosition.Y);
                _logger.LogDebug("Adding TLS return command: {ReturnCmd}", returnCmd);
                finalCommands.Add(new ProcessedCommand
                {
                    Command = returnCmd,
                    DisplayCommand = returnCmd,
                    IsOriginal = false
                });
            }

            finalCommands.Add(ToolChangeSentinel.Sync());
            finalCommands.Add(ToolChangeSentinel.Complete(toolChangeId));
        }

        return new CommandProcessorResult
        {
            ShouldContinue = finalCommands.Count > 0,
            Commands = finalCommands
        };
    }

    private CommandProcessorResult Refuse(string command, CommandProcessorContext context, string reason, bool stopsJob)
    {
        if (string.IsNullOrEmpty(context.CommandId))
            context.CommandId = Guid.NewGuid().ToString();   // keep terminal rows distinct
        BlockedCommandNotice.Broadcast(_broadcaster, context.CommandId, command, reason, context.Meta?.SourceId);
        return new CommandProcessorResult
        {
            ShouldContinue = false,
            SkipReason = $"Command blocked: {reason}",
            Error = stopsJob ? reason : null,
        };
    }

    // Suppress the "(keepout bypassed)" audit tag on plugin-expanded lines
    // — a tool change typically emits a dozen bypassed G53 moves in a row
    // and each one carrying the tag turns the terminal into wallpaper.
    // User-typed `$keepout_off` commands never go through this path (they
    // hit the "single original" branch above and return the inner result
    // unchanged), so their audit annotation stays intact.
    private const string BypassSuffix = " (keepout bypassed)";
    private static string? StripBypassAnnotation(string? display)
    {
        if (display is null) return null;
        return display.EndsWith(BypassSuffix, StringComparison.Ordinal)
            ? display[..^BypassSuffix.Length]
            : display;
    }

    private static XyPosition? ParseMachinePosition(string? mpos)
    {
        if (string.IsNullOrWhiteSpace(mpos))
            return null;

        var parts = mpos.Split(',');
        if (parts.Length < 2)
            return null;

        if (double.TryParse(parts[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var x)
            && double.TryParse(parts[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var y))
            return new XyPosition { X = x, Y = y };

        return null;
    }

    private static bool IsDoorOpen(MachineState ms)
    {
        if (ms is null) return false;
        if (string.Equals(ms.Status, "Door", StringComparison.OrdinalIgnoreCase)) return true;
        if (!string.IsNullOrEmpty(ms.Pn) && ms.Pn.IndexOf('D') >= 0) return true;
        return false;
    }

    private async Task<List<ProcessedCommand>> RunPluginChainAsync(
        List<ProcessedCommand> commands, List<string> pluginIds,
        CommandProcessorContext context, List<ToolInfo> tools)
    {
        foreach (var pluginId in pluginIds)
            commands = await _jsEngine.ProcessOnBeforeCommandAsync(pluginId, commands, context, tools);
        return commands;
    }

    // A plugin marker such as `$ADB_GOTO 32` written inside another plugin's
    // expansion (a tool changer's Pre/Post Tool Change event) used to reach the
    // controller as-is: the plugin that owns it runs earlier in the chain and
    // only ever saw the M6, so grblHAL rejected the line and the tool change
    // stopped. Each marker line now goes through the plugin chain once, as if
    // typed, and its expansion takes the line's place. That expansion is never
    // scanned again, so a plugin answering a marker with a marker cannot loop.
    private static readonly Regex NestedMarker = new(@"^\$[A-Za-z][A-Za-z0-9]*_\w*", RegexOptions.Compiled);

    // `$keepout_off` is the host's own prefix on a tool changer's rack moves,
    // not a plugin marker: run as typed, a plugin could take the rack move for
    // a console rapid.
    private static bool IsNestedMarker(string line) =>
        NestedMarker.IsMatch(line) && !line.StartsWith("$keepout_off", StringComparison.OrdinalIgnoreCase);

    private async Task<List<ProcessedCommand>> ExpandNestedMarkersAsync(
        List<ProcessedCommand> commands, List<string> pluginIds,
        CommandProcessorContext context, List<ToolInfo> tools)
    {
        var result = new List<ProcessedCommand>(commands.Count);
        foreach (var cmd in commands)
        {
            if (cmd.IsOriginal || !cmd.Command.Split('\n').Any(l => IsNestedMarker(l.Trim())))
            {
                result.Add(cmd);
                continue;
            }

            // Keep the plain lines around each marker together, as the plugin wrote them.
            var plain = new List<string>();
            foreach (var line in cmd.Command.Split('\n'))
            {
                var expansion = IsNestedMarker(line.Trim())
                    ? await ExpandMarkerAsync(line.Trim(), cmd.Meta, pluginIds, context, tools)
                    : null;
                if (expansion is null)
                {
                    plain.Add(line);
                    continue;
                }
                if (plain.Count > 0) result.Add(LikeCommand(cmd, string.Join("\n", plain)));
                plain.Clear();
                result.AddRange(expansion);
            }
            if (plain.Count > 0) result.Add(LikeCommand(cmd, string.Join("\n", plain)));
        }
        return result;
    }

    // The marker's expansion, or null when no plugin claims it (the line is
    // then sent as before and the controller decides).
    private async Task<List<ProcessedCommand>?> ExpandMarkerAsync(
        string marker, CommandMeta? meta, List<string> pluginIds,
        CommandProcessorContext context, List<ToolInfo> tools)
    {
        var expanded = await RunPluginChainAsync(
            [new ProcessedCommand { Command = marker, IsOriginal = true, Meta = meta }],
            pluginIds, context, tools);
        if (expanded.Count == 1 && expanded[0].IsOriginal && expanded[0].Command.Trim() == marker)
            return null;

        _logger.LogDebug("Expanded nested plugin marker {Marker} into {Count} line(s)", marker, expanded.Count);
        foreach (var c in expanded)
        {
            c.IsOriginal = false;   // part of the outer expansion now
            c.Meta ??= meta;
        }
        return expanded;
    }

    private static ProcessedCommand LikeCommand(ProcessedCommand source, string command) => new()
    {
        Command = command,
        DisplayCommand = source.DisplayCommand,
        IsOriginal = false,
        Meta = source.Meta,
        Cleanup = source.Cleanup
    };
}
