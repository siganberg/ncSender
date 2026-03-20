using System.Globalization;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Core.Utils;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.CommandProcessor;

public class CommandProcessor : ICommandProcessor
{
    private const double DoorMaxFeedRate = 1000;

    private readonly IServerContext _context;
    private readonly IBroadcaster _broadcaster;
    private readonly IFirmwareService _firmwareService;
    private readonly ISettingsManager _settingsManager;
    private readonly ILogger<CommandProcessor> _logger;

    public CommandProcessor(
        IServerContext context,
        IBroadcaster broadcaster,
        IFirmwareService firmwareService,
        ISettingsManager settingsManager,
        ILogger<CommandProcessor> logger)
    {
        _context = context;
        _broadcaster = broadcaster;
        _firmwareService = firmwareService;
        _settingsManager = settingsManager;
        _logger = logger;
    }

    public async Task<CommandProcessorResult> ProcessAsync(string command, CommandProcessorContext processorContext)
    {
        var machineState = processorContext.MachineState;

        // 1. Door state safety checks
        var doorResult = CheckDoorStateSafety(command, processorContext);
        if (doorResult is not null)
            return doorResult;

        // 2. Hold/Pause state safety checks
        var holdResult = CheckHoldStateSafety(command, processorContext);
        if (holdResult is not null)
            return holdResult;

        // 3. Bitfield setting validation
        var bitfieldResult = await CheckBitfieldSettingAsync(command, processorContext);
        if (bitfieldResult is not null)
            return bitfieldResult;

        // 4. $NCSENDER_CLEAR_MSG handling
        if (command.Trim().Equals("$NCSENDER_CLEAR_MSG", StringComparison.OrdinalIgnoreCase))
        {
            return HandleClearMsg(processorContext);
        }

        // 5. Check if this is a valid M6 command
        var m6Parse = GcodePatterns.ParseM6Command(command);
        var isValidM6 = m6Parse.Matched && m6Parse.ToolNumber is not null;

        // 6. Check if this is a $TLS command
        var isTLS = GcodePatterns.IsTlsCommand(command);

        // 7. Same-tool M6 skip
        var currentTool = machineState.Tool;
        var sameToolCheck = GcodePatterns.CheckSameToolChange(command, currentTool);

        // 8. Determine return position for M6 tool change
        XyPosition? m6ReturnPosition = null;
        var m6UseWorkCoordinates = false;
        if (isValidM6 && !sameToolCheck.IsSameTool)
        {
            var nextXY = processorContext.NextXYPosition;
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
                {
                    _logger.LogDebug("Saved M6 return position (MPos): X{X:F3} Y{Y:F3}",
                        m6ReturnPosition.X, m6ReturnPosition.Y);
                }
            }
        }

        // 10. Save return position for $TLS
        XyPosition? tlsReturnPosition = null;
        if (isTLS)
        {
            tlsReturnPosition = ParseMachinePosition(machineState.MPos);
            if (tlsReturnPosition is not null)
            {
                _logger.LogDebug("Saved TLS return position: X{X:F3} Y{Y:F3}",
                    tlsReturnPosition.X, tlsReturnPosition.Y);
            }
        }

        // 11. Set isToolChanging flag for $TLS
        if (isTLS && !_context.State.MachineState.IsToolChanging)
        {
            _context.State.MachineState.IsToolChanging = true;
            _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        }

        // 12. Set isToolChanging flag for valid M6 (non-same-tool)
        if (isValidM6 && !sameToolCheck.IsSameTool && !_context.State.MachineState.IsToolChanging)
        {
            _context.State.MachineState.IsToolChanging = true;
            _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        }

        // 13. Same-tool M6 skip
        if (sameToolCheck.IsSameTool)
        {
            var skipMessage = $"M6 T{sameToolCheck.ToolNumber}; Skipped, target tool is the same as the current tool.";
            _logger.LogInformation("Same-tool M6 detected: T{Tool} (current: T{Current}) - skipping",
                sameToolCheck.ToolNumber, currentTool);

            _ = _broadcaster.Broadcast("cnc-command", new WsCncCommandStatus(
                processorContext.CommandId ?? "",
                command.Trim().ToUpperInvariant(),
                skipMessage,
                "pending",
                DateTime.UtcNow.ToString("o"),
                processorContext.Meta?.SourceId ?? "client"
            ), NcSenderJsonContext.Default.WsCncCommandStatus);

            _ = _broadcaster.Broadcast("cnc-command-result", new WsCncCommandStatus(
                processorContext.CommandId ?? "",
                command.Trim().ToUpperInvariant(),
                skipMessage,
                "success",
                DateTime.UtcNow.ToString("o"),
                processorContext.Meta?.SourceId ?? "client"
            ), NcSenderJsonContext.Default.WsCncCommandStatus);

            return new CommandProcessorResult
            {
                ShouldContinue = false,
                SkipReason = $"Same tool T{currentTool} already loaded"
            };
        }

        // 14. Build command list — start with the original command
        var commands = new List<ProcessedCommand>
        {
            new()
            {
                Command = command,
                IsOriginal = true,
                Meta = processorContext.Meta
            }
        };

        // 15. If valid M6 (non-same-tool), append return-to-position + sentinel
        if (isValidM6)
        {
            // Return-to-position only for manual invocation (not during program run)
            if (m6ReturnPosition is not null && !m6UseWorkCoordinates)
            {
                var returnCmd = string.Format(CultureInfo.InvariantCulture, "G53 G21 G0 X{0:F3} Y{1:F3}", m6ReturnPosition.X, m6ReturnPosition.Y);
                _logger.LogDebug("Adding M6 return command: {ReturnCmd}", returnCmd);
                commands.Add(new ProcessedCommand
                {
                    Command = returnCmd,
                    DisplayCommand = returnCmd,
                    IsOriginal = false
                });
            }

            commands.Add(new ProcessedCommand
            {
                Command = "(MSG, TOOL_CHANGE_COMPLETE)",
                DisplayCommand = "(tool change sentinel)",
                IsOriginal = false,
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });
        }

        // 16. If $TLS, add return-to-position + sentinel
        if (isTLS)
        {
            if (tlsReturnPosition is not null)
            {
                var returnCmd = string.Format(CultureInfo.InvariantCulture, "G53 G21 G0 X{0:F3} Y{1:F3}", tlsReturnPosition.X, tlsReturnPosition.Y);
                _logger.LogDebug("Adding TLS return command: {ReturnCmd}", returnCmd);
                commands.Add(new ProcessedCommand
                {
                    Command = returnCmd,
                    DisplayCommand = returnCmd,
                    IsOriginal = false
                });
            }

            commands.Add(new ProcessedCommand
            {
                Command = "(MSG, TOOL_CHANGE_COMPLETE)",
                DisplayCommand = "(tool change sentinel)",
                IsOriginal = false,
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });
        }

        // 17. M98 detection — warn and pass through (full expansion deferred)
        if (GcodePatterns.IsM98Command(command))
        {
            _logger.LogWarning("M98 subprogram call detected at line {Line}: {Command}",
                processorContext.LineNumber, command);
        }

        return new CommandProcessorResult
        {
            ShouldContinue = true,
            Commands = commands
        };
    }

    private CommandProcessorResult? CheckDoorStateSafety(string command, CommandProcessorContext ctx)
    {
        var machineState = ctx.MachineState;
        var isDoorActive = machineState.Pn.Contains('D') ||
                           machineState.Status.Equals("Door", StringComparison.OrdinalIgnoreCase);

        if (!isDoorActive)
            return null;

        var trimmed = command.Trim();

        // Allow real-time commands (single character control codes)
        if (trimmed.Length == 1)
        {
            var c = trimmed[0];
            if (c is '!' or '~' or '?' or '\x18' or '\x84' or '\x85' or '\x87' || c >= 0x80)
                return null;
        }

        // Block G0 rapid moves (but NOT jog commands)
        if (GcodePatterns.IsRapidMove(trimmed) && !GcodePatterns.IsJogCommand(trimmed))
        {
            _logger.LogDebug("Door safety: Blocking G0 rapid move \"{Command}\"", trimmed);
            return CreateBlockedResult(ctx, trimmed, "G0 rapid not allowed in Door state");
        }

        // Block spindle start (M3/M4)
        if (GcodePatterns.IsSpindleStartCommand(trimmed))
        {
            _logger.LogDebug("Door safety: Blocking spindle start \"{Command}\"", trimmed);
            return CreateBlockedResult(ctx, trimmed, "Spindle start not allowed in Door state");
        }

        // Limit feed rate on jog commands ($J=)
        if (GcodePatterns.IsJogCommand(trimmed))
        {
            var limitResult = GcodePatterns.LimitFeedRate(trimmed, DoorMaxFeedRate);
            if (limitResult.WasLimited)
            {
                _logger.LogDebug("Door safety: Jog feed rate limited to {MaxFeed}mm/min", DoorMaxFeedRate);
                return CreateModifiedResult(limitResult);
            }
            return null;
        }

        // Limit feed rate on G1/G2/G3 movements
        if (GcodePatterns.IsFeedMove(trimmed))
        {
            var limitResult = GcodePatterns.LimitFeedRate(trimmed, DoorMaxFeedRate);
            if (limitResult.WasLimited)
            {
                _logger.LogDebug("Door safety: Feed rate limited to {MaxFeed}mm/min", DoorMaxFeedRate);
                return CreateModifiedResult(limitResult);
            }
            return null;
        }

        return null;
    }

    private CommandProcessorResult? CheckHoldStateSafety(string command, CommandProcessorContext ctx)
    {
        var machineState = ctx.MachineState;
        var isHoldActive = machineState.Status.StartsWith("Hold", StringComparison.OrdinalIgnoreCase);

        if (!isHoldActive)
            return null;

        var trimmed = command.Trim();

        // Allow real-time commands (single character control codes)
        if (trimmed.Length == 1)
        {
            var c = trimmed[0];
            if (c is '!' or '~' or '?' or '\x18' or '\x84' or '\x85' or '\x87' || c >= 0x80)
                return null;
        }

        // Allow synthetic app commands that never go to the CNC
        if (trimmed.Equals("$NCSENDER_CLEAR_MSG", StringComparison.OrdinalIgnoreCase))
            return null;

        // Block everything else
        _logger.LogDebug("Hold safety: Blocking command \"{Command}\"", trimmed);
        return CreateCancelledResult(ctx, trimmed);
    }

    private async Task<CommandProcessorResult?> CheckBitfieldSettingAsync(string command, CommandProcessorContext ctx)
    {
        var parsed = GcodePatterns.ParseFirmwareSetting(command);
        if (!parsed.Matched || parsed.SettingId is null || parsed.Value is null)
            return null;

        var firmware = await _firmwareService.GetCachedAsync();
        if (firmware is null)
            return null;

        if (!firmware.Settings.TryGetValue(parsed.SettingId, out var settingDef))
            return null;

        if (settingDef.DataType != 2) // Not a bitfield
            return null;

        if (!int.TryParse(parsed.Value, out var numValue))
            return null;

        // Valid: 0, or odd (bit 0 set)
        if (numValue == 0 || numValue % 2 != 0)
            return null;

        // Invalid bitfield: non-zero even number
        var displayCommand = $"${parsed.SettingId}={parsed.Value} (Ignoring, bitfield value must be 0 or odd)";
        _logger.LogDebug("Invalid bitfield: {Display}", displayCommand);

        BroadcastCommandStatus(ctx, command.Trim(), displayCommand, "pending");
        BroadcastCommandStatus(ctx, command.Trim(), displayCommand, "success", eventType: "cnc-command-result");

        return new CommandProcessorResult
        {
            ShouldContinue = false,
            SkipReason = displayCommand
        };
    }

    private CommandProcessorResult HandleClearMsg(CommandProcessorContext ctx)
    {
        _logger.LogDebug("$NCSENDER_CLEAR_MSG command detected - clearing plugin message");

        // Clear persisted plugin dialog so it doesn't reappear on refresh
        ClearPluginMessageAsync();

        async void ClearPluginMessageAsync()
        {
            try { await _settingsManager.RemoveSetting("pluginMessage"); }
            catch (Exception ex) { _logger.LogError(ex, "Failed to clear pluginMessage from settings"); }
        }

        BroadcastCommandStatus(ctx, "$NCSENDER_CLEAR_MSG", "$NCSENDER_CLEAR_MSG", "pending");
        BroadcastCommandStatus(ctx, "$NCSENDER_CLEAR_MSG", "$NCSENDER_CLEAR_MSG", "success", eventType: "cnc-command-result");

        return new CommandProcessorResult
        {
            ShouldContinue = false,
            SkipReason = "$NCSENDER_CLEAR_MSG handled"
        };
    }

    private CommandProcessorResult CreateBlockedResult(CommandProcessorContext ctx, string command, string reason)
    {
        var blockedDisplay = $"{command} (BLOCKED - {reason})";

        BroadcastCommandStatus(ctx, command, blockedDisplay, "pending");
        BroadcastCommandStatus(ctx, command, blockedDisplay, "blocked", eventType: "cnc-command-result");

        return new CommandProcessorResult
        {
            ShouldContinue = false,
            SkipReason = $"Command blocked: {reason}"
        };
    }

    private CommandProcessorResult CreateCancelledResult(CommandProcessorContext ctx, string command)
    {
        var cancelledDisplay = $"{command}  (Cancelled, not allowed during HOLD)";

        BroadcastCommandStatus(ctx, command, cancelledDisplay, "pending");
        BroadcastCommandStatus(ctx, command, cancelledDisplay, "blocked", eventType: "cnc-command-result");

        return new CommandProcessorResult
        {
            ShouldContinue = false,
            SkipReason = "Command cancelled: not allowed during HOLD"
        };
    }

    private static CommandProcessorResult CreateModifiedResult(FeedRateLimitResult limitResult)
    {
        var displayCommand = $"{limitResult.Command} (F{limitResult.OriginalFeedRate} -> F{DoorMaxFeedRate}, Door safety)";

        return new CommandProcessorResult
        {
            ShouldContinue = true,
            Commands =
            [
                new ProcessedCommand
                {
                    Command = limitResult.Command,
                    DisplayCommand = displayCommand,
                    IsOriginal = true
                }
            ]
        };
    }

    private void BroadcastCommandStatus(
        CommandProcessorContext ctx, string command, string displayCommand,
        string status, string eventType = "cnc-command")
    {
        _ = _broadcaster.Broadcast(eventType, new WsCncCommandStatus(
            ctx.CommandId ?? "",
            command,
            displayCommand,
            status,
            DateTime.UtcNow.ToString("o"),
            ctx.Meta?.SourceId ?? "client"
        ), NcSenderJsonContext.Default.WsCncCommandStatus);
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
}
