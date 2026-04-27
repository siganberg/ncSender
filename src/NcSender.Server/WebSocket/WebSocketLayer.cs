using System.Buffers;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.WebSocket;

public class WebSocketLayer : IBroadcaster
{
    private static readonly string ServerVersion = BuildVersion.Value.Contains("-dev", StringComparison.Ordinal) ? "dev" : BuildVersion.Value;


    private readonly ConcurrentDictionary<string, ClientConnection> _clients = new();
    private readonly ILogger<WebSocketLayer> _logger;
    private readonly IServerContext _context;
    private readonly ISettingsManager _settings;

    private ICncController? _controller;
    private ICommandProcessor? _commandProcessor;
    private IJobManager? _jobManager;
    private IJogManager? _jogManager;
    private NcSender.Server.Plugins.PluginDialogDispatcher? _dialogDispatcher;

    public WebSocketLayer(ILogger<WebSocketLayer> logger, IServerContext context, ISettingsManager settings)
    {
        _logger = logger;
        _context = context;
        _settings = settings;
    }

    public int ConnectedCount => _clients.Count;

    public void SetController(ICncController controller)
    {
        _controller = controller;
    }

    public void SetCommandProcessor(ICommandProcessor processor)
    {
        _commandProcessor = processor;
    }

    public void SetJobManager(IJobManager jobManager)
    {
        _jobManager = jobManager;
    }

    public void SetJogManager(IJogManager jogManager)
    {
        _jogManager = jogManager;
    }

    public void SetDialogDispatcher(NcSender.Server.Plugins.PluginDialogDispatcher dispatcher)
    {
        _dialogDispatcher = dispatcher;
    }

    public async Task HandleConnection(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = 400;
            return;
        }

        var ws = await context.WebSockets.AcceptWebSocketAsync();
        var query = context.Request.Query;
        var clientId = $"client-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Random.Shared.Next(1000, 9999)}";

        var remoteIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var isLocal = remoteIp is "127.0.0.1" or "::1" or "::ffff:127.0.0.1" or "localhost";

        var client = new ClientConnection(clientId, ws)
        {
            Ip = remoteIp,
            IsLocal = isLocal,
            Product = query["product"].FirstOrDefault(),
            MachineId = query["machineId"].FirstOrDefault(),
            Version = query["version"].FirstOrDefault(),
            Licensed = bool.TryParse(query["licensed"].FirstOrDefault(), out var lic) && lic,
            PreferWifi = !bool.TryParse(query["preferWifi"].FirstOrDefault(), out var pw) || pw
        };

        _clients.TryAdd(clientId, client);
        _logger.LogInformation("WebSocket client connected: {ClientId} from {Ip}", clientId, remoteIp);

        try
        {
            // Send client-id handshake
            var remoteControlEnabled = _settings.GetSetting<bool>("remoteControl.enabled", false);
            await SendMessage(ws, "client-id", JsonSerializer.SerializeToElement(
                new WsClientId(clientId, isLocal, remoteControlEnabled, ServerVersion),
                NcSenderJsonContext.Default.WsClientId));

            // Send full initial state to new client
            _context.UpdateSenderStatus();
            await SendMessage(ws, "server-state-updated", JsonSerializer.SerializeToElement(
                _context.State, NcSenderJsonContext.Default.ServerState));

            // Send greeting to late-joining clients so it appears in the terminal
            var greeting = _controller?.GreetingMessage;
            _logger.LogInformation("WebSocket client {ClientId}: greeting={Greeting}", clientId, greeting ?? "(null)");
            if (greeting is not null)
            {
                await SendMessage(ws, "initial-greeting", JsonSerializer.SerializeToElement(greeting, NcSenderJsonContext.Default.String));
            }

            // Send gcode-updated to trigger content download if a file is loaded
            if (_context.State.JobLoaded?.Filename is not null)
            {
                await SendMessage(ws, "gcode-updated", JsonSerializer.SerializeToElement(
                    new WsGcodeUpdated(_context.State.JobLoaded.Filename, _context.State.JobLoaded.TotalLines),
                    NcSenderJsonContext.Default.WsGcodeUpdated));
            }

            await ReceiveLoop(client);
        }
        catch (WebSocketException ex) when (ex.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
        {
            _logger.LogDebug("Client {ClientId} disconnected abruptly", clientId);
        }
        finally
        {
            _clients.TryRemove(clientId, out _);

            // Clean up jog sessions for disconnected client
            if (_jogManager is not null)
            {
                try
                {
                    await _jogManager.HandleDisconnectAsync(clientId);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug("Failed to cleanup jog sessions for {ClientId}: {Error}", clientId, ex.Message);
                }
            }

            _logger.LogInformation("WebSocket client disconnected: {ClientId}", clientId);

            if (ws.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                try
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Server closing", CancellationToken.None);
                }
                catch { /* best effort */ }
            }
        }
    }

    public async Task Broadcast(string type, JsonElement data)
    {
        var payload = SerializeMessage(type, data);

        var tasks = _clients.Values
            .Where(c => c.Socket.State == WebSocketState.Open)
            .Select(c => SendRaw(c.Socket, payload));

        await Task.WhenAll(tasks);
    }

    public async Task SendToClient(string clientId, string type, JsonElement data)
    {
        if (_clients.TryGetValue(clientId, out var client) && client.Socket.State == WebSocketState.Open)
        {
            await SendMessage(client.Socket, type, data);
        }
    }

    private async Task ReceiveLoop(ClientConnection client)
    {
        var buffer = new byte[4096];

        while (client.Socket.State == WebSocketState.Open)
        {
            var result = await client.Socket.ReceiveAsync(buffer, CancellationToken.None);

            if (result.MessageType == WebSocketMessageType.Close)
                break;

            if (result.MessageType == WebSocketMessageType.Text)
            {
                var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                await HandleClientMessage(client, message);
            }
        }
    }

    private async Task HandleClientMessage(ClientConnection client, string rawMessage)
    {
        try
        {
            // Clone the root element so fire-and-forget handlers can safely access it
            // after the JsonDocument is disposed (handlers may await across the using scope)
            JsonElement root;
            string? type;
            using (var doc = JsonDocument.Parse(rawMessage))
            {
                root = doc.RootElement.Clone();
                type = root.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;
            }

            if (type is null) return;

            // Fire-and-forget all handlers so the WebSocket receive loop stays
            // unblocked. V1 parity: all message handlers use .catch() or async IIFE
            // without await. Commands like M0 hold until ~ (cycle start), which
            // arrives as a subsequent WebSocket message on this same loop.
            switch (type)
            {
                case "cnc:command":
                    _ = HandleCncCommand(client, root);
                    break;

                case "job:start":
                    _ = HandleJobStart();
                    break;

                case "job:pause":
                    _ = HandleJobPause();
                    break;

                case "job:resume":
                    _ = HandleJobResume();
                    break;

                case "job:stop":
                    _ = HandleJobStop();
                    break;

                case "job:progress:close":
                    HandleJobProgressClose();
                    break;

                case "jog:start":
                case "jog:heartbeat":
                case "jog:stop":
                case "jog:step":
                    if (_jogManager is not null)
                    {
                        var jogData = root.TryGetProperty("data", out var jogDataProp) ? jogDataProp : root;
                        _ = _jogManager.HandleMessageAsync(client.ClientId, type, jogData);
                    }
                    break;

                case "plugin-dialog-response":
                    if (_dialogDispatcher is not null
                        && root.TryGetProperty("data", out var dlgData)
                        && dlgData.TryGetProperty("dialogId", out var dlgIdProp)
                        && dlgIdProp.GetString() is string dlgId)
                    {
                        var resp = dlgData.TryGetProperty("response", out var respProp)
                            ? respProp
                            : default;
                        _dialogDispatcher.Resolve(dlgId, resp);
                    }
                    break;

                default:
                    _logger.LogDebug("Unknown WebSocket message type: {Type} from {ClientId}", type, client.ClientId);
                    break;
            }
        }
        catch (JsonException)
        {
            _logger.LogDebug("Invalid JSON from {ClientId}: {Message}", client.ClientId, rawMessage);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Error handling message from {ClientId}: {Error}", client.ClientId, ex.Message);
        }
    }

    private async Task HandleCncCommand(ClientConnection client, JsonElement root)
    {
        if (_controller is null)
        {
            await this.SendToClient(client.ClientId, "cnc-command-result",
                new WsCncCommandError("error", "Controller not available"),
                NcSenderJsonContext.Default.WsCncCommandError);
            return;
        }

        var data = root.TryGetProperty("data", out var dataProp) ? dataProp : root;
        var command = data.TryGetProperty("command", out var cmdProp) ? cmdProp.GetString() : null;

        if (string.IsNullOrEmpty(command))
        {
            _logger.LogWarning("cnc:command missing 'command' field. Payload: {Data}", data.ToString());
            await this.SendToClient(client.ClientId, "cnc-command-result",
                new WsCncCommandError("error", "Command is required"),
                NcSenderJsonContext.Default.WsCncCommandError);
            return;
        }

        // Translate hex byte input (0xHH or \xHH) to actual byte — V1: translateCommandInput
        command = TranslateHexCommand(command, out var translatedDisplay);

        // Intercept soft reset during active job — V1 behavior:
        // Send feed hold first, pause job, wait for deceleration, stop job, then let soft reset proceed
        if (command == "\x18" && _jobManager is not null && _jobManager.HasActiveJob)
        {
            var jobStatus = _context.State.JobLoaded?.Status;
            if (jobStatus is "running" or "paused")
            {
                var pauseBeforeStop = _settings.GetSetting<int>("pauseBeforeStop", 500);
                _logger.LogInformation("Soft reset during active job — feed hold first (delay={Delay}ms)", pauseBeforeStop);

                // Send feed hold
                await _controller.SendCommandAsync("!", new CommandOptions
                {
                    DisplayCommand = "! (Feed Hold)",
                    Meta = new CommandMeta { SourceId = "client", Silent = true }
                });

                _jobManager.Pause();

                // Wait for deceleration
                await Task.Delay(pauseBeforeStop);

                // Stop the job before sending soft reset
                _jobManager.Stop();
                _logger.LogInformation("Job stopped, sending soft reset");
            }
        }

        var commandId = data.TryGetProperty("commandId", out var idProp) ? idProp.GetString() : null;
        var displayCommand = data.TryGetProperty("displayCommand", out var dispProp) ? dispProp.GetString() : null;

        // Use translated display if hex input was resolved, otherwise fall back to realtime description
        displayCommand ??= translatedDisplay ?? DescribeRealtimeCommand(command);

        // Extract meta fields from client payload
        var meta = new CommandMeta { SourceId = "client" };
        if (data.TryGetProperty("meta", out var metaProp) && metaProp.ValueKind == System.Text.Json.JsonValueKind.Object)
        {
            if (metaProp.TryGetProperty("sourceId", out var sid)) meta.SourceId = sid.GetString();
            if (metaProp.TryGetProperty("completesCommandId", out var ccid)) meta.CompletesCommandId = ccid.GetString();
            if (metaProp.TryGetProperty("stopReason", out var sr)) meta.StopReason = sr.GetString();
            if (metaProp.TryGetProperty("silent", out var sl) && sl.GetBoolean()) meta.Silent = true;
            if (metaProp.TryGetProperty("continuous", out var co) && co.GetBoolean()) meta.Continuous = true;
        }
        else
        {
            // Legacy: sourceId at top level
            if (data.TryGetProperty("sourceId", out var srcProp))
                meta.SourceId = srcProp.GetString();
        }

        try
        {
            if (_commandProcessor is not null)
            {
                // Route through command processor for plugin expansion + safety checks
                var processorContext = new CommandProcessorContext
                {
                    CommandId = commandId,
                    Meta = meta,
                    MachineState = _context.State.MachineState,
                    LineNumber = 0
                };

                var result = await _commandProcessor.ProcessAsync(command, processorContext);

                if (result.ShouldContinue)
                {
                    foreach (var cmd in result.Commands)
                    {
                        // V1 parity: unique ID per command, display falls back to
                        // actual command text, meta merges original with per-command
                        var cmdId = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}"[..24];
                        var cmdDisplay = cmd.DisplayCommand ?? cmd.Command;
                        var cmdMeta = MergeMeta(meta, cmd.Meta);

                        var options = new CommandOptions
                        {
                            CommandId = cmdId,
                            DisplayCommand = cmdDisplay,
                            Meta = cmdMeta
                        };
                        await _controller.SendCommandAsync(cmd.Command, options);
                    }
                }
            }
            else
            {
                // Fallback: send directly
                var options = new CommandOptions
                {
                    CommandId = commandId,
                    DisplayCommand = displayCommand,
                    Meta = meta
                };
                await _controller.SendCommandAsync(command, options);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("CNC command failed: {Error}", ex.Message);
        }
    }

    private async Task HandleJobStart()
    {
        if (_jobManager is null) return;

        try
        {
            await _jobManager.StartJobAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start job via WebSocket");
        }
    }

    private async Task HandleJobPause()
    {
        if (_jobManager is null || _controller is null) return;

        // Send feed hold to GRBL
        await _controller.SendCommandAsync("!", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "system", Silent = true }
        });

        _jobManager.Pause();
    }

    private async Task HandleJobResume()
    {
        if (_jobManager is null || _controller is null) return;

        // Send cycle resume to GRBL
        await _controller.SendCommandAsync("~", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "system", Silent = true }
        });

        _jobManager.Resume();
    }

    private async Task HandleJobStop()
    {
        if (_jobManager is null || _controller is null) return;

        var pauseBeforeStop = _settings.GetSetting<int>("pauseBeforeStop", 500);

        // Send feed hold
        await _controller.SendCommandAsync("!", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "system", Silent = true }
        });

        // Wait before soft reset
        await Task.Delay(pauseBeforeStop);

        // Send soft reset
        await _controller.SendCommandAsync("\x18", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "system", Silent = true }
        });

        _jobManager.Stop();
    }

    private void HandleJobProgressClose()
    {
        var job = _context.State.JobLoaded;
        if (job is null) return;

        // Reset progress fields — V1 sets status to null to dismiss the progress panel
        job.Status = null;
        job.CurrentLine = 0;
        job.JobStartTime = null;
        job.JobEndTime = null;
        job.JobPauseAt = null;
        job.JobPausedTotalSec = 0;
        job.RemainingSec = null;
        job.ProgressPercent = 0;
        job.RuntimeSec = 0;

        _context.UpdateSenderStatus();
        _ = this.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
    }

    /// <summary>
    /// Translate hex byte input (0xHH or \xHH) to actual single byte — V1: translateCommandInput.
    /// Returns the original command if not a hex pattern.
    /// </summary>
    private static string TranslateHexCommand(string command, out string? displayHex)
    {
        displayHex = null;
        var trimmed = command.Trim();
        if (trimmed.Length == 4
            && (trimmed.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("\\x", StringComparison.OrdinalIgnoreCase)))
        {
            var hexPart = trimmed[2..];
            if (byte.TryParse(hexPart, System.Globalization.NumberStyles.HexNumber, null, out var b))
            {
                displayHex = $"0x{hexPart.ToUpperInvariant()}";
                return ((char)b).ToString();
            }
        }
        return command;
    }

    private static string? DescribeRealtimeCommand(string command)
    {
        if (command.Length != 1) return null;
        return command[0] switch
        {
            '\x85' => "0x85 (Jog Cancel)",
            '\x84' => "0x84 (Safety Door)",
            '\x87' => "0x87 (Status Report)",
            '\x18' => "0x18 (Soft Reset)",
            '!' => "! (Feed Hold)",
            '~' => "~ (Cycle Start/Resume)",
            '\x90' => "0x90 (Feed Rate Override Reset 100%)",
            '\x91' => "0x91 (Feed Rate Override +10%)",
            '\x92' => "0x92 (Feed Rate Override -10%)",
            '\x93' => "0x93 (Feed Rate Override +1%)",
            '\x94' => "0x94 (Feed Rate Override -1%)",
            '\x99' => "0x99 (Spindle Speed Override Reset 100%)",
            '\x9A' => "0x9A (Spindle Speed Override +10%)",
            '\x9B' => "0x9B (Spindle Speed Override -10%)",
            '\x9C' => "0x9C (Spindle Speed Override +1%)",
            '\x9D' => "0x9D (Spindle Speed Override -1%)",
            _ => null
        };
    }

    /// <summary>
    /// Merge original request meta with per-command meta (V1: { ...metaPayload, ...(cmd.meta || {}) }).
    /// Per-command meta fields override the original.
    /// </summary>
    private static CommandMeta MergeMeta(CommandMeta original, CommandMeta? perCommand)
    {
        if (perCommand is null)
            return original;

        return new CommandMeta
        {
            SourceId = perCommand.SourceId ?? original.SourceId,
            Silent = perCommand.Silent || original.Silent,
            Continuous = perCommand.Continuous || original.Continuous,
            SkipJogCancel = perCommand.SkipJogCancel || original.SkipJogCancel,
            SilentCompletion = perCommand.SilentCompletion || original.SilentCompletion,
            CompletesCommandId = perCommand.CompletesCommandId ?? original.CompletesCommandId,
            StopReason = perCommand.StopReason ?? original.StopReason
        };
    }

    private static async Task SendMessage(System.Net.WebSockets.WebSocket ws, string type, JsonElement data)
    {
        var payload = SerializeMessage(type, data);
        await SendRaw(ws, payload);
    }

    private static byte[] SerializeMessage(string type, JsonElement data)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using var writer = new Utf8JsonWriter(buffer);
        writer.WriteStartObject();
        writer.WriteString("type", type);
        writer.WritePropertyName("data");
        data.WriteTo(writer);
        writer.WriteEndObject();
        writer.Flush();
        return buffer.WrittenSpan.ToArray();
    }

    private static async Task SendRaw(System.Net.WebSockets.WebSocket ws, byte[] payload)
    {
        if (ws.State != WebSocketState.Open) return;

        try
        {
            await ws.SendAsync(payload, WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (WebSocketException)
        {
            // Client disconnected — handled in ReceiveLoop
        }
    }
}
