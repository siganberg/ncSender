using System.Collections.Concurrent;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Jogging;

public class JogManager : IJogManager
{
    private const int WatchdogTimeoutMs = 2000;

    private readonly ICncController _controller;
    private readonly ICommandProcessor _commandProcessor;
    private readonly IBroadcaster _broadcaster;
    private readonly ILogger<JogManager> _logger;
    private readonly ConcurrentDictionary<string, JogSession> _sessions = new();

    public JogManager(ICncController controller, ICommandProcessor commandProcessor, IBroadcaster broadcaster, ILogger<JogManager> logger)
    {
        _controller = controller;
        _commandProcessor = commandProcessor;
        _broadcaster = broadcaster;
        _logger = logger;
    }

    public async Task HandleMessageAsync(string clientId, string type, JsonElement data)
    {
        switch (type)
        {
            case "jog:start":
                await HandleJogStart(clientId, data);
                break;
            case "jog:heartbeat":
                HandleJogHeartbeat(clientId, data);
                break;
            case "jog:stop":
                await HandleJogStop(clientId, data);
                break;
            case "jog:step":
                await HandleJogStep(clientId, data);
                break;
        }
    }

    public async Task HandleDisconnectAsync(string clientId)
    {
        var sessionIds = _sessions.Keys.Where(k => k.StartsWith($"{clientId}:")).ToList();

        foreach (var sessionId in sessionIds)
        {
            if (_sessions.TryRemove(sessionId, out var session))
            {
                session.Watchdog?.Dispose();
                try { await SendJogCancel(); }
                catch (Exception ex) { _logger.LogDebug("Jog cancel on disconnect failed: {Error}", ex.Message); }
                _logger.LogDebug("Cleaned up jog session {SessionId} on disconnect", sessionId);
            }
        }
    }

    private async Task HandleJogStart(string clientId, JsonElement data)
    {
        var jogId = data.TryGetProperty("jogId", out var idProp) ? idProp.GetString() ?? "" : "";
        var command = data.TryGetProperty("command", out var cmdProp) ? cmdProp.GetString() : null;

        if (string.IsNullOrWhiteSpace(command))
            return;

        var sessionId = $"{clientId}:{jogId}";

        // Clean up any existing session with same ID
        if (_sessions.TryRemove(sessionId, out var existing))
            existing.Watchdog?.Dispose();

        var session = new JogSession
        {
            ClientId = clientId,
            JogId = jogId,
            Command = command
        };

        // Start watchdog timer
        session.Watchdog = new Timer(
            _ => OnWatchdogTimeout(sessionId),
            null,
            WatchdogTimeoutMs,
            Timeout.Infinite);

        _sessions[sessionId] = session;

        // Route through CommandProcessor for safety checks (matches V1 pattern)
        var processorContext = new CommandProcessorContext
        {
            MachineState = _controller.LastStatus,
            CommandId = jogId,
            Meta = new CommandMeta { SourceId = "jog" }
        };

        var result = await _commandProcessor.ProcessAsync(command, processorContext);
        if (!result.ShouldContinue)
        {
            _sessions.TryRemove(sessionId, out _);
            session.Watchdog?.Dispose();
            _logger.LogDebug("Jog start blocked by CommandProcessor: jogId={JogId}, reason={Reason}", jogId, result.SkipReason);
            await _broadcaster.SendToClient(clientId, "jog:start-failed",
                new WsJogStartFailed(jogId, result.SkipReason ?? "Jog command blocked"),
                NcSenderJsonContext.Default.WsJogStartFailed);
            return;
        }

        // Send processed commands — not silent so it broadcasts to terminal (V1 behavior)
        // Continuous flag ensures result is sent with silentCompletion
        foreach (var cmd in result.Commands)
        {
            await _controller.SendCommandAsync(cmd.Command, new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "jog", Continuous = true, TimeoutMs = 500 }
            });
        }

        await _broadcaster.SendToClient(clientId, "jog:started",
            new WsJogStarted(jogId), NcSenderJsonContext.Default.WsJogStarted);
    }

    private void HandleJogHeartbeat(string clientId, JsonElement data)
    {
        var jogId = data.TryGetProperty("jogId", out var idProp) ? idProp.GetString() ?? "" : "";
        var sessionId = $"{clientId}:{jogId}";

        if (_sessions.TryGetValue(sessionId, out var session))
        {
            // Reset watchdog timer
            session.Watchdog?.Change(WatchdogTimeoutMs, Timeout.Infinite);
        }
    }

    private async Task HandleJogStop(string clientId, JsonElement data)
    {
        var jogId = data.TryGetProperty("jogId", out var idProp) ? idProp.GetString() ?? "" : "";
        var sessionId = $"{clientId}:{jogId}";

        if (_sessions.TryRemove(sessionId, out var session))
        {
            session.Watchdog?.Dispose();

            try { await SendJogCancel(); }
            catch (Exception ex) { _logger.LogDebug("Jog cancel on stop failed: {Error}", ex.Message); }
        }

        await _broadcaster.SendToClient(clientId, "jog:stopped",
            new WsJogStopped(jogId), NcSenderJsonContext.Default.WsJogStopped);
    }

    private async Task HandleJogStep(string clientId, JsonElement data)
    {
        var command = data.TryGetProperty("command", out var cmdProp) ? cmdProp.GetString() : null;
        if (string.IsNullOrWhiteSpace(command)) return;

        var commandId = data.TryGetProperty("commandId", out var idProp) ? idProp.GetString() : null;
        var displayCommand = data.TryGetProperty("displayCommand", out var dispProp) ? dispProp.GetString() : null;
        var skipJogCancel = data.TryGetProperty("skipJogCancel", out var skipProp) && skipProp.GetBoolean();
        var silent = data.TryGetProperty("silent", out var silentProp) && silentProp.GetBoolean();

        try
        {
            // Route through CommandProcessor for safety checks (matches V1 pattern)
            var processorContext = new CommandProcessorContext
            {
                MachineState = _controller.LastStatus,
                CommandId = commandId,
                Meta = new CommandMeta { SourceId = "jog" }
            };

            var result = await _commandProcessor.ProcessAsync(command, processorContext);
            if (!result.ShouldContinue)
                return; // Silently skip — step jogs are rapid-fire

            foreach (var cmd in result.Commands)
            {
                await _controller.SendCommandAsync(cmd.Command, new CommandOptions
                {
                    CommandId = commandId,
                    DisplayCommand = cmd.DisplayCommand ?? displayCommand,
                    Meta = new CommandMeta { SourceId = "jog", Silent = silent, SkipJogCancel = skipJogCancel, TimeoutMs = 500 }
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Jog step failed: {Error}", ex.Message);
        }
    }

    private async void OnWatchdogTimeout(string sessionId)
    {
        if (_sessions.TryRemove(sessionId, out var session))
        {
            session.Watchdog?.Dispose();
            _logger.LogDebug("Jog watchdog timeout for session {SessionId}", sessionId);

            try
            {
                await SendJogCancel();
                await _broadcaster.SendToClient(session.ClientId, "jog:stopped",
                    new WsJogStopped(session.JogId, "timeout"), NcSenderJsonContext.Default.WsJogStopped);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to handle jog watchdog timeout");
            }
        }
    }

    private async Task SendJogCancel()
    {
        if (!_controller.IsConnected) return;

        // Send jog cancel (0x85)
        await _controller.SendCommandAsync("\x85", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "system", Silent = true }
        });
    }

    private class JogSession
    {
        public string ClientId { get; init; } = "";
        public string JogId { get; init; } = "";
        public string Command { get; init; } = "";
        public Timer? Watchdog { get; set; }
    }
}
