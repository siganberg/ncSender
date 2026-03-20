using System.Globalization;
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
    private readonly IBroadcaster _broadcaster;
    private readonly ISettingsManager _settingsManager;
    private readonly ILogger<PluginCommandProcessor> _logger;

    public PluginCommandProcessor(
        ICommandProcessor inner,
        IJsPluginEngine jsEngine,
        IToolService toolService,
        IServerContext serverContext,
        IBroadcaster broadcaster,
        ISettingsManager settingsManager,
        ILogger<PluginCommandProcessor> logger)
    {
        _inner = inner;
        _jsEngine = jsEngine;
        _toolService = toolService;
        _serverContext = serverContext;
        _broadcaster = broadcaster;
        _settingsManager = settingsManager;
        _logger = logger;
    }

    public async Task<CommandProcessorResult> ProcessAsync(string command, CommandProcessorContext context)
    {
        var pluginIds = _jsEngine.GetLoadedPluginIds();

        // No plugins — pass through to inner processor (which handles everything)
        if (pluginIds.Count == 0)
            return await _inner.ProcessAsync(command, context);

        // --- Pre-processing: detect M6/$TLS before plugin expansion (matches V1 flow) ---

        var machineState = context.MachineState;
        var m6Parse = GcodePatterns.ParseM6Command(command);
        var isValidM6 = m6Parse.Matched && m6Parse.ToolNumber is not null;
        var isTLS = GcodePatterns.IsTlsCommand(command);

        var currentTool = machineState.Tool;
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

        // Set isToolChanging flag
        if ((isValidM6 || isTLS) && !_serverContext.State.MachineState.IsToolChanging)
        {
            _serverContext.State.MachineState.IsToolChanging = true;
            _ = _broadcaster.Broadcast("server-state-updated", _serverContext.State, NcSenderJsonContext.Default.ServerState);
        }

        // --- Plugin expansion ---

        var commands = new List<ProcessedCommand>
        {
            new() { Command = command, IsOriginal = true, Meta = context.Meta }
        };

        var tools = await _toolService.GetAllAsync();
        foreach (var pluginId in pluginIds)
        {
            commands = _jsEngine.ProcessOnBeforeCommand(pluginId, commands, context, tools);
        }

        // If plugin didn't modify (single original command), use inner processor directly
        // Inner processor handles all its own logic (door safety, return-to-position, etc.)
        if (commands.Count == 1 && commands[0].IsOriginal)
            return await _inner.ProcessAsync(commands[0].Command, context);

        // --- Plugin expanded: run each through inner for safety checks ---

        _logger.LogDebug("Plugin expanded {Original} into {Count} commands", command, commands.Count);

        var finalCommands = new List<ProcessedCommand>();
        foreach (var cmd in commands)
        {
            var innerResult = await _inner.ProcessAsync(cmd.Command, context);
            if (innerResult.ShouldContinue)
            {
                foreach (var innerCmd in innerResult.Commands)
                {
                    finalCommands.Add(new ProcessedCommand
                    {
                        Command = innerCmd.Command,
                        DisplayCommand = cmd.DisplayCommand ?? innerCmd.DisplayCommand,
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
            // Switch probe source for TLS during tool change (same as $TLS handling)
            const int probeIdx = 0;
            var tlsIdx = _settingsManager.GetSetting<int>("tlsIndex", 0);

            if (tlsIdx != probeIdx)
            {
                finalCommands.Insert(0, new ProcessedCommand
                {
                    Command = $"G65P5Q{tlsIdx}",
                    DisplayCommand = $"G65P5Q{tlsIdx} (switch to TLS probe source)",
                    IsOriginal = false
                });

                finalCommands.Add(new ProcessedCommand
                {
                    Command = $"G65P5Q{probeIdx}",
                    DisplayCommand = $"G65P5Q{probeIdx} (restore probe source)",
                    IsOriginal = false
                });
            }

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

            finalCommands.Add(new ProcessedCommand
            {
                Command = "(MSG, TOOL_CHANGE_COMPLETE)",
                IsOriginal = false,
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });
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
                    IsOriginal = false
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

            finalCommands.Add(new ProcessedCommand
            {
                Command = "(MSG, TOOL_CHANGE_COMPLETE)",
                IsOriginal = false,
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });
        }

        return new CommandProcessorResult
        {
            ShouldContinue = finalCommands.Count > 0,
            Commands = finalCommands
        };
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
