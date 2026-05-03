using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using NcSender.Core.Constants;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Connection;

public partial class CncController : ICncController
{
    [GeneratedRegex(@"G10\s+L(2|20)\b", RegexOptions.IgnoreCase)]
    private static partial Regex G10WcoPattern();

    [GeneratedRegex(@"M64\s*P(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex M64Pattern();

    [GeneratedRegex(@"M65\s*P(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex M65Pattern();

    private readonly ILogger<CncController> _logger;
    private readonly ISettingsManager _settings;
    private readonly IProtocolHandler[] _protocolHandlers;

    private IConnectionTransport? _transport;
    private IProtocolHandler? _activeProtocol;
    private PeriodicTimer? _pollTimer;
    private CancellationTokenSource? _pollCts;
    private Task? _pollTask;

    // Command queue
    private Channel<CommandEntry>? _commandChannel;
    private CancellationTokenSource? _queueCts;
    private Task? _queueConsumerTask;
    private CommandEntry? _activeCommand;
    private readonly object _activeLock = new();
    private readonly ConcurrentDictionary<string, CommandEntry> _pendingCommands = new();
    private string? _lastJogDirection;

    // Raw mode (for Ymodem etc.) — suspends line-based parsing
    private volatile bool _rawMode;

    // Connection state
    private bool _isVerifying;
    private bool _hasReceivedFirstStatus;
    private bool _hasReceivedGreeting;
    private string? _greetingMessage;
    private CancellationTokenSource? _verificationCts;
    private string? _rawStatusData;
    private string? _pendingFullStatusSourceId;
    private MachineState _lastStatus = new();

    // Throttling
    #pragma warning disable CS0414
    private long _lastConnectionErrorLog;
    #pragma warning restore CS0414
    private long _lastDisconnectLog;
    private long _lastConnectionOpenLog;
    private const long ConnectionErrorThrottleMs = 30000;

    // Commands to skip in command-sent logs (noisy/system)
    private static readonly HashSet<string> LogSkipCommands = new(StringComparer.OrdinalIgnoreCase) { "?", "$PINSTATE" };

    // Watched fields for change detection
    private static readonly string[] WatchedStatusFields =
    [
        "Status", "Homed", "Workspace", "Tool", "ToolLengthSet",
        "SpindleActive", "FloodCoolant", "MistCoolant",
        "FeedrateOverride", "RapidOverride", "ActiveProbe"
    ];

    // Relevant fields for determining if a status report has changes worth emitting
    private static readonly string[] RelevantFields =
    [
        "ActiveProbe", "Status", "FeedRate", "SpindleRpmTarget", "SpindleRpmActual",
        "FeedrateOverride", "RapidOverride", "SpindleOverride",
        "Tool", "ToolLengthSet", "Homed", "Pn",
        "SpindleActive", "FloodCoolant", "MistCoolant", "Workspace"
    ];

    private volatile bool _isConnecting;
    public bool IsConnected { get; private set; }
    public bool IsTransportOpen => _transport is not null;
    public string ConnectionStatus { get; private set; } = "disconnected";
    public MachineState LastStatus => _lastStatus;
    public string? RawStatusData => _rawStatusData;
    public string? GreetingMessage => _greetingMessage;

    public IConnectionTransport? Transport => _transport;
    public IProtocolHandler? ActiveProtocol => _activeProtocol;

    public event Action<string, bool>? ConnectionStatusChanged;
    public event Action<MachineState>? StatusReportReceived;
    public event Action<CommandResult>? CommandQueued;
    public event Action<CommandResult>? CommandAcknowledged;
    public event Action<string, string?>? DataReceived;
    public event Action<CncError>? ErrorReceived;
    public event Action? StopReceived;
    public event Action? PauseReceived;
    public event Action? ResumeReceived;
    public event Action? UnlockReceived;

    public CncController(ILogger<CncController> logger, ISettingsManager settings, IEnumerable<IProtocolHandler> protocolHandlers)
    {
        _logger = logger;
        _settings = settings;
        _protocolHandlers = protocolHandlers.ToArray();
    }

    public async Task ConnectAsync(ConnectionSettings settings, CancellationToken ct = default)
    {
        if (IsConnected || _isConnecting)
        {
            _logger.LogInformation("Already connected or connecting to CNC controller");
            return;
        }

        _isConnecting = true;
        try
        {
            var type = settings.Type.ToLowerInvariant();
            EmitConnectionStatus("connecting", false);

            IConnectionTransport transport = type switch
            {
                "usb" => new SerialTransport(settings.UsbPort, settings.BaudRate),
                "ethernet" when settings.Protocol.Equals("websocket", StringComparison.OrdinalIgnoreCase)
                    => new WebSocketTransport(settings.Ip, settings.Port),
                "ethernet" => new TcpTransport(settings.Ip, settings.Port),
                _ => throw new ArgumentException($"Unsupported connection type: {type}")
            };

            transport.LineReceived += HandleIncomingData;
            transport.ConnectionLost += OnConnectionLost;

            try
            {
                await transport.ConnectAsync(ct);
            }
            catch (Exception ex)
            {
                transport.LineReceived -= HandleIncomingData;
                transport.ConnectionLost -= OnConnectionLost;
                await transport.DisposeAsync();
                HandleConnectionError(ex);
                throw;
            }

            _transport = transport;
            OnConnectionEstablished(type);
        }
        finally
        {
            _isConnecting = false;
        }
    }

    public void Disconnect()
    {
        _logger.LogInformation("Disconnecting CNC controller");
        StopPolling();
        FlushQueue("disconnect");


        var transport = _transport;
        _transport = null;

        if (transport is not null)
        {
            transport.LineReceived -= HandleIncomingData;
            transport.ConnectionLost -= OnConnectionLost;
            _ = transport.DisposeAsync();
        }

        StopQueueConsumer();

        IsConnected = false;
        ConnectionStatus = "disconnected";
        _isVerifying = false;
        _hasReceivedFirstStatus = false;
        _hasReceivedGreeting = false;
        _greetingMessage = null;
        _activeProtocol = null;
        EmitConnectionStatus("disconnected", false);
    }

    private void OnConnectionEstablished(string type)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (now - _lastConnectionOpenLog > ConnectionErrorThrottleMs)
        {
            _logger.LogInformation("CNC controller connection opened via {Type}, verifying controller readiness...", type);
            _lastConnectionOpenLog = now;
        }

        _lastConnectionErrorLog = 0;
        _lastDisconnectLog = 0;
        _isVerifying = true;
        _hasReceivedFirstStatus = false;
        _hasReceivedGreeting = false;
        _greetingMessage = null;
        _activeProtocol = null;

        EmitConnectionStatus("verifying", false);

        StartQueueConsumer();
        _logger.LogInformation("Queue consumer started, sending soft-reset...");

        // Send soft-reset — the controller will respond with its greeting,
        // which determines the protocol handler. Polling starts after greeting.
        _ = SendCommandAsync("\x18", new CommandOptions { Meta = new CommandMeta { SourceId = "system" } })
            .ContinueWith(t =>
            {
                if (t.IsFaulted)
                {
                    var msg = t.Exception?.InnerException?.Message ?? t.Exception?.Message ?? "unknown error";
                    _logger.LogWarning("Soft-reset send failed: {Error}", msg);
                }
                else
                    _logger.LogInformation("Soft-reset sent, waiting for greeting...");
            });

        // Start verification timeout — disconnect if no greeting received.
        // 15s covers FluidNC's slow boot (config dump + WiFi STA connect +
        // mDNS) which routinely exceeds 5s before the canonical Grbl
        // greeting line is emitted. grblHAL is sub-second so this is safe.
        _verificationCts?.Cancel();
        _verificationCts = new CancellationTokenSource();
        var cts = _verificationCts;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(15000, cts.Token);
                if (_isVerifying && !_hasReceivedGreeting)
                {
                    _logger.LogWarning("No CNC greeting received within 15s, disconnecting (wrong device?)");
                    OnConnectionLost(new TimeoutException("No CNC greeting received"));
                }
            }
            catch (OperationCanceledException) { }
        });
    }

    private void OnConnectionLost(Exception? ex)
    {
        // Guard against multiple invocations from concurrent write/read failures
        if (!IsConnected && !_isVerifying)
            return;

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (now - _lastDisconnectLog > ConnectionErrorThrottleMs)
        {
            _logger.LogInformation("CNC controller connection lost: {Error}", ex?.Message ?? "closed");
            _lastDisconnectLog = now;
        }

        IsConnected = false;
        ConnectionStatus = "disconnected";
        _isVerifying = false;
        _hasReceivedFirstStatus = false;
        _hasReceivedGreeting = false;
        _greetingMessage = null;
        _activeProtocol = null;

        StopPolling();
        FlushQueue("connection-lost");


        // Clean up the stale transport (matching Disconnect() behavior)
        var transport = _transport;
        _transport = null;

        if (transport is not null)
        {
            transport.LineReceived -= HandleIncomingData;
            transport.ConnectionLost -= OnConnectionLost;
            _ = transport.DisposeAsync();
        }

        StopQueueConsumer();

        EmitConnectionStatus("disconnected", false);
    }

    private void HandleConnectionError(Exception ex)
    {
        IsConnected = false;
        ConnectionStatus = "error";
        _isVerifying = false;
        _hasReceivedFirstStatus = false;
        _hasReceivedGreeting = false;
        _greetingMessage = null;
        _activeProtocol = null;
        FlushQueue("connection-error");
        EmitConnectionStatus("error", false);
    }

    private void EmitConnectionStatus(string status, bool isConnected)
    {
        ConnectionStatus = status;
        IsConnected = isConnected;
        ConnectionStatusChanged?.Invoke(status, isConnected);
    }

    #region Command Queue

    private void StartQueueConsumer()
    {
        StopQueueConsumer();

        _commandChannel = Channel.CreateBounded<CommandEntry>(200);
        _queueCts = new CancellationTokenSource();
        _queueConsumerTask = ConsumeQueueAsync(_queueCts.Token);
    }

    private void StopQueueConsumer()
    {
        _commandChannel?.Writer.TryComplete();
        _queueCts?.Cancel();

        if (_queueConsumerTask is not null)
        {
            try { _queueConsumerTask.Wait(TimeSpan.FromSeconds(2)); }
            catch { /* best effort */ }
        }

        _queueCts?.Dispose();
        _queueCts = null;
        _queueConsumerTask = null;
        _commandChannel = null;
    }

    private async Task ConsumeQueueAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var entry in _commandChannel!.Reader.ReadAllAsync(ct))
            {
                // Move from pending → active (V1 parity: pendingCommands.delete())
                _pendingCommands.TryRemove(entry.Id, out _);
                lock (_activeLock) _activeCommand = entry;

                try
                {
                    if (_transport is null || (!IsConnected && !_isVerifying))
                    {
                        var error = new Exception("Connection is not available");
                        entry.Tcs.TrySetException(error);
                        EmitCommandAck(entry, "error", error.Message);
                        continue;
                    }

                    if (entry.PrependJogCancel)
                        await _transport.WriteRawAsync([0x85], ct);

                    await _transport.WriteAsync(entry.CommandToWrite, ct);

                    LogCommandSent(entry.RawCommand, isRealTime: false);

                    // Per-command timeout (see CommandTimeoutPolicy) only applies to
                    // direct user-driven sources where a stuck queue feels like a
                    // frozen UI: terminal/panel input (client), jog buttons,
                    // pendant. Everything else (job/macro streaming, internal
                    // system/event/probe/controller-files calls) waits as long as
                    // the controller takes — the planner buffer paces things
                    // naturally and a slow motion can legitimately delay "ok".
                    var sourceId = entry.Meta?.SourceId;
                    var isManual = sourceId is "client" or "jog" or "usb-pendant";
                    var timeout = isManual ? CommandTimeoutPolicy.GetTimeout(entry.RawCommand) : null;
                    try
                    {
                        if (timeout is { } t)
                            await entry.Tcs.Task.WaitAsync(t, ct);
                        else
                            await entry.Tcs.Task.WaitAsync(ct);
                    }
                    catch (TimeoutException)
                    {
                        var msg = $"No 'ok' from controller within {timeout!.Value.TotalSeconds:0.##}s for: {entry.RawCommand}";
                        _logger.LogWarning(msg);
                        var err = new TimeoutException(msg);
                        entry.Tcs.TrySetException(err);
                        EmitCommandAck(entry, "error", msg);
                        // Continue draining the queue — don't soft-reset. If the
                        // controller is genuinely hung, subsequent commands will
                        // also time out and the user can hit Stop manually.
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    entry.Tcs.TrySetCanceled(ct);
                    break;
                }
                catch (Exception ex)
                {
                    entry.Tcs.TrySetException(ex);
                }
                finally
                {
                    lock (_activeLock) _activeCommand = null;
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    public async Task WriteRawAsync(byte[] data, CancellationToken ct = default)
    {
        if (_transport is null)
            throw new InvalidOperationException("CNC controller is not connected");

        await _transport.WriteRawAsync(data, ct);
    }

    public void EnterRawMode() => _rawMode = true;

    public void ExitRawMode() => _rawMode = false;

    public async Task<CommandResult> SendCommandAsync(string command, CommandOptions? options = null)
    {
        if ((!IsConnected && !_isVerifying) || _transport is null)
            throw new InvalidOperationException("CNC controller is not connected");

        var meta = options?.Meta;
        var commandId = options?.CommandId ?? $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}"[..24];
        var displayCommand = options?.DisplayCommand;

        // Don't trim single-byte realtime commands (0x85 jog cancel, 0x18 soft reset, etc.)
        var cleanCommand = (command.Length == 1 && (command[0] < 0x20 || command[0] > 0x7E))
            ? command
            : command.Trim();
        if (string.IsNullOrEmpty(cleanCommand))
            throw new ArgumentException("Command is empty");

        // Intercept user ? command — return cached status
        if (cleanCommand == "?" && meta?.SourceId != "system")
        {
            var cachedData = _rawStatusData ?? "<Idle>";
            var pendingResult = new CommandResult
            {
                Id = commandId,
                Command = cleanCommand,
                DisplayCommand = displayCommand ?? cleanCommand,
                Meta = meta,
                Status = "success",
                RealTime = true,
                Data = cachedData,
                Timestamp = DateTime.UtcNow.ToString("o")
            };

            CommandQueued?.Invoke(pendingResult);
            CommandAcknowledged?.Invoke(pendingResult);
            DataReceived?.Invoke(cachedData, meta?.SourceId);
            return pendingResult;
        }

        // Check if this is a real-time command
        char[] realTimeChars = ['!', '~', '?', '\x18'];
        var isRealTime = cleanCommand.Length == 1 &&
            (realTimeChars.Contains(cleanCommand[0]) || cleanCommand[0] >= 0x80);

        string commandToSend;
        if (isRealTime)
        {
            commandToSend = cleanCommand;
        }
        else
        {
            var hasVariableSyntax = cleanCommand.StartsWith('%') || cleanCommand.Contains('[');
            commandToSend = (hasVariableSyntax ? cleanCommand : cleanCommand.ToUpperInvariant()) + "\n";
        }

        // Track pending full status report request (0x87) from user
        if (cleanCommand.Length == 1 && cleanCommand[0] == 0x87 && meta?.SourceId != "system")
            _pendingFullStatusSourceId = meta?.SourceId;

        // Prepend 0x85 jog cancel only when jog direction changes
        var prependJogCancel = false;
        if (cleanCommand.StartsWith("$J=", StringComparison.OrdinalIgnoreCase))
        {
            var dir = GetJogDirection(cleanCommand);
            if (_lastJogDirection != null && dir != _lastJogDirection)
                prependJogCancel = true;
            _lastJogDirection = dir;
        }

        if (isRealTime)
        {
            return await SendRealTimeCommand(cleanCommand, commandToSend, commandId, displayCommand, meta);
        }

        // Coolant/aux commands bypass the queue — send immediately so they work during job execution
        if (IsCoolantOrAuxCommand(normalizedCommand: cleanCommand.ToUpperInvariant()))
        {
            return await SendImmediateCommand(cleanCommand, commandToSend, commandId, displayCommand, meta);
        }

        // Regular queued command
        var hasVarSyntax = cleanCommand.StartsWith('%') || cleanCommand.Contains('[');
        var normalizedCommand = hasVarSyntax ? cleanCommand : cleanCommand.ToUpperInvariant();

        // Track M64/M65 output pin state changes
        TrackOutputPinCommand(normalizedCommand);
        var display = displayCommand ?? cleanCommand;

        var entry = new CommandEntry
        {
            Id = commandId,
            RawCommand = normalizedCommand,
            CommandToWrite = commandToSend,
            PrependJogCancel = prependJogCancel,
            Meta = meta,
            DisplayCommand = display,
            Tcs = new TaskCompletionSource<CommandResult>(TaskCreationOptions.RunContinuationsAsynchronously)
        };

        var pendingPayload = new CommandResult
        {
            Id = commandId,
            Command = normalizedCommand,
            DisplayCommand = display,
            Meta = meta,
            Status = "pending",
            Timestamp = DateTime.UtcNow.ToString("o")
        };

        // Track in pending map BEFORE broadcasting (V1 parity: pendingCommands.set()).
        // FlushQueue iterates this to catch commands not yet in the channel.
        _pendingCommands[commandId] = entry;

        CommandQueued?.Invoke(pendingPayload);

        if (_commandChannel is null || !_commandChannel.Writer.TryWrite(entry))
        {
            // Queue full or not available — wait for space
            if (_commandChannel is not null)
                await _commandChannel.Writer.WriteAsync(entry);
            else
            {
                _pendingCommands.TryRemove(commandId, out _);
                throw new InvalidOperationException("Command queue is not available");
            }
        }

        return await entry.Tcs.Task;
    }

    private async Task<CommandResult> SendRealTimeCommand(
        string command, string commandToSend,
        string commandId, string? displayCommand, CommandMeta? meta)
    {
        var display = displayCommand ?? command;
        var pendingResult = new CommandResult
        {
            Id = commandId,
            Command = command,
            DisplayCommand = display,
            Meta = meta,
            Status = "pending",
            RealTime = true,
            Timestamp = DateTime.UtcNow.ToString("o")
        };

        CommandQueued?.Invoke(pendingResult);

        try
        {
            // Realtime commands with bytes > 0x7F (like 0x85 jog cancel) must be sent
            // as raw bytes — WriteAsync(string) would UTF-8 encode them incorrectly
            if (commandToSend.Length == 1 && commandToSend[0] > 0x7E)
                await _transport!.WriteRawAsync([(byte)commandToSend[0]]);
            else
                await _transport!.WriteAsync(commandToSend);

            LogCommandSent(command, isRealTime: true);

            if (command == "\x18")
            {
                FlushQueue("soft-reset");
                StopReceived?.Invoke();
            }
            else if (command == "!")
            {
                PauseReceived?.Invoke();
            }
            else if (command == "~")
            {
                ResumeReceived?.Invoke();
            }

            var ackResult = new CommandResult
            {
                Id = commandId,
                Command = command,
                DisplayCommand = display,
                Meta = meta,
                Status = "success",
                RealTime = true,
                Timestamp = DateTime.UtcNow.ToString("o")
            };

            CommandAcknowledged?.Invoke(ackResult);
            return ackResult;
        }
        catch (Exception ex)
        {
            var errorResult = new CommandResult
            {
                Id = commandId,
                Command = command,
                DisplayCommand = display,
                Meta = meta,
                Status = "error",
                RealTime = true,
                ErrorMessage = ex.Message,
                Timestamp = DateTime.UtcNow.ToString("o")
            };

            CommandAcknowledged?.Invoke(errorResult);
            throw;
        }
    }

    private static bool IsCoolantOrAuxCommand(string normalizedCommand)
    {
        return normalizedCommand is "M7" or "M8" or "M9"
            || normalizedCommand.StartsWith("M64", StringComparison.Ordinal)
            || normalizedCommand.StartsWith("M65", StringComparison.Ordinal);
    }

    private async Task<CommandResult> SendImmediateCommand(string command, string commandToSend, string commandId, string? displayCommand, CommandMeta? meta)
    {
        var display = displayCommand ?? command;
        var normalized = command.ToUpperInvariant();

        TrackOutputPinCommand(normalized);

        var pendingResult = new CommandResult
        {
            Id = commandId,
            Command = normalized,
            DisplayCommand = display,
            Meta = meta,
            Status = "pending",
            Timestamp = DateTime.UtcNow.ToString("o")
        };
        CommandQueued?.Invoke(pendingResult);

        try
        {
            await _transport!.WriteAsync(commandToSend);
            LogCommandSent(command, isRealTime: false);

            var ackResult = new CommandResult
            {
                Id = commandId,
                Command = normalized,
                DisplayCommand = display,
                Meta = meta,
                Status = "success",
                Timestamp = DateTime.UtcNow.ToString("o")
            };
            CommandAcknowledged?.Invoke(ackResult);
            return ackResult;
        }
        catch (Exception ex)
        {
            var errorResult = new CommandResult
            {
                Id = commandId,
                Command = normalized,
                DisplayCommand = display,
                Meta = meta,
                Status = "error",
                ErrorMessage = ex.Message,
                Timestamp = DateTime.UtcNow.ToString("o")
            };
            CommandAcknowledged?.Invoke(errorResult);
            throw;
        }
    }

    public void FlushQueue(string reason)
    {
        // 1. Flush active command
        CommandEntry? active;
        lock (_activeLock)
        {
            active = _activeCommand;
            _activeCommand = null;
        }

        if (active is not null)
        {
            _pendingCommands.TryRemove(active.Id, out _);
            active.Tcs.TrySetCanceled();
            EmitCommandAck(active, "flushed", reason);
        }

        // 2. Drain channel entries
        if (_commandChannel is not null)
        {
            while (_commandChannel.Reader.TryRead(out var entry))
            {
                _pendingCommands.TryRemove(entry.Id, out _);
                entry.Tcs.TrySetCanceled();
                EmitCommandAck(entry, "flushed", reason);
            }
        }

        // 3. Flush any remaining pending commands not yet in the channel
        //    (V1 parity: pendingCommands.forEach() + .clear())
        foreach (var kvp in _pendingCommands)
        {
            if (_pendingCommands.TryRemove(kvp.Key, out var entry))
            {
                entry.Tcs.TrySetCanceled();
                EmitCommandAck(entry, "flushed", reason);
            }
        }
    }

    private void EmitCommandAck(CommandEntry entry, string status, string? errorMessage = null)
    {
        CommandAcknowledged?.Invoke(new CommandResult
        {
            Id = entry.Id,
            Command = entry.RawCommand,
            DisplayCommand = entry.DisplayCommand,
            Meta = entry.Meta,
            Status = status,
            ErrorMessage = errorMessage,
            Timestamp = DateTime.UtcNow.ToString("o")
        });
    }

    private void LogCommandSent(string command, bool isRealTime)
    {
        if (LogSkipCommands.Contains(command)) return;

        var formatted = FormatCommandForLog(command);

        if (isRealTime)
            _logger.LogInformation("Real-time command sent: {Command}", formatted);
        else
            _logger.LogInformation("Command sent: {Command}", formatted);
    }

    private static string FormatCommandForLog(string command)
    {
        // Convert control characters to hex display, matching V1's formatCommandForLog
        var parts = new List<string>();
        foreach (var ch in command)
        {
            if (ch < 0x20 || ch > 0x7E)
                parts.Add($"0x{(int)ch:X2}");
            else
                parts.Add(ch.ToString());
        }
        return string.Concat(parts).ToUpperInvariant();
    }

    private static string GetJogDirection(string command)
    {
        var parts = new List<string>();
        foreach (Match m in Regex.Matches(command, @"([XYZABC])\s*(-?)", RegexOptions.IgnoreCase))
        {
            parts.Add(m.Groups[1].Value.ToUpperInvariant() + (m.Groups[2].Value == "-" ? "-" : "+"));
        }
        parts.Sort();
        return string.Join("", parts);
    }

    private void LogControllerData(string data)
    {
        _logger.LogInformation("CNC data: {Data}", data);
    }

    private void LogControllerResponse(string response)
    {
        _logger.LogInformation("CNC controller responded: {Response}", response);
    }

    #endregion

    #region Protocol Parser

    internal void HandleIncomingData(string trimmedData)
    {
        // In raw mode (Ymodem etc.), skip line-based parsing
        if (_rawMode) return;

        // Status report (<...>)
        if (trimmedData.EndsWith('>'))
        {
            // If we got a GRBL status report but no greeting yet (e.g., e-stop/alarm active),
            // cancel the greeting timeout — we know this is a real CNC controller.
            // The greeting may still arrive and will set the active protocol.
            if (!_hasReceivedGreeting && trimmedData.StartsWith('<'))
            {
                _verificationCts?.Cancel();
                _logger.LogInformation("Status report received before greeting — controller detected, waiting for protocol identification");
            }

            if (_isVerifying && !_hasReceivedFirstStatus)
            {
                _hasReceivedFirstStatus = true;
                _isVerifying = false;
                _logger.LogInformation("CNC controller connected — first status received");
                EmitConnectionStatus("connected", true);

                // Send protocol-specific init commands
                if (_activeProtocol is not null)
                {
                    var systemMeta = new CommandOptions { Meta = new CommandMeta { SourceId = "system" } };
                    foreach (var cmd in _activeProtocol.GetInitCommands())
                        _ = SendCommandAsync(cmd, systemMeta);
                }

            }

            _rawStatusData = trimmedData;
            ParseStatusReport(trimmedData);

            // Emit raw status to terminal for pending 0x87 full status request
            if (_pendingFullStatusSourceId is not null)
            {
                DataReceived?.Invoke(trimmedData, _pendingFullStatusSourceId);
                _pendingFullStatusSourceId = null;
            }
        }
        // G-code parser state ([GC:...])
        else if (trimmedData.StartsWith("[GC:") && trimmedData.EndsWith(']'))
        {
            ParseGCodeModes(trimmedData);
            var sourceId = GetActiveSourceId();
            DataReceived?.Invoke(trimmedData, sourceId);
        }
        // Work offsets ([G54:...] through [G59:...])
        else if (trimmedData.Length > 6 && trimmedData[0] == '[' && trimmedData[1] == 'G' && trimmedData[2] == '5'
                 && trimmedData[3] >= '4' && trimmedData[3] <= '9' && trimmedData[4] == ':' && trimmedData[^1] == ']')
        {
            ParseWorkOffset(trimmedData);
            LogControllerData(trimmedData);
            var sourceId = GetActiveSourceId();
            DataReceived?.Invoke(trimmedData, sourceId);
        }
        // Error response
        else if (trimmedData.StartsWith("error:", StringComparison.OrdinalIgnoreCase))
        {
            LogControllerResponse(trimmedData);
            if (_activeProtocol is not null && _activeProtocol.TryParseError(trimmedData, out var code, out var message))
            {
                var isSystemCommand = GetActiveSourceId() == "system";
                HandleCommandError(message, code);
                if (!isSystemCommand)
                    ErrorReceived?.Invoke(new CncError { Code = code?.ToString() ?? "", Message = message });
            }
            else
            {
                // Fallback: parse error code directly
                var codePart = trimmedData.Split(':')[1];
                if (int.TryParse(codePart, out var fallbackCode))
                {
                    var msg = GrblErrors.GetMessage(fallbackCode);
                    var isSystemCommand = GetActiveSourceId() == "system";
                    HandleCommandError(msg, fallbackCode);
                    if (!isSystemCommand)
                        ErrorReceived?.Invoke(new CncError { Code = fallbackCode.ToString(), Message = msg });
                }
            }
        }
        // Alarm
        else if (trimmedData.StartsWith("alarm", StringComparison.OrdinalIgnoreCase))
        {
            int? alarmCode = null;
            var match = System.Text.RegularExpressions.Regex.Match(trimmedData, @"alarm:(\d+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (match.Success)
                alarmCode = int.Parse(match.Groups[1].Value);

            HandleCommandError(trimmedData, null);
            ErrorReceived?.Invoke(new CncError
            {
                Code = "ALARM",
                AlarmCode = alarmCode,
                Message = trimmedData
            });
        }
        // Ok response
        else if (string.Equals(trimmedData, "ok", StringComparison.OrdinalIgnoreCase) ||
                 trimmedData.EndsWith(":ok", StringComparison.OrdinalIgnoreCase))
        {
            LogControllerResponse("ok");
            HandleCommandOk();
        }
        // Trailing ok (grblHAL $F<= file dump appends 'ok' to last content line)
        else if (trimmedData.Length > 2 &&
                 trimmedData[^2..].Equals("ok", StringComparison.OrdinalIgnoreCase) &&
                 !trimmedData.EndsWith(":ok", StringComparison.OrdinalIgnoreCase))
        {
            var dataLine = trimmedData[..^2];
            if (!string.IsNullOrWhiteSpace(dataLine))
            {
                LogControllerData(dataLine);
                var sourceId = GetActiveSourceId();
                DataReceived?.Invoke(dataLine, sourceId);
            }
            LogControllerResponse("ok");
            HandleCommandOk();
        }
        else
        {
            // If we receive a pendant/dongle ID or pendant ping during verification, wrong device
            if (_isVerifying && !_hasReceivedGreeting)
            {
                if (trimmedData.StartsWith("$ID:", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogWarning("Connected to {Device} instead of CNC controller, disconnecting", trimmedData);
                    OnConnectionLost(new InvalidOperationException($"Wrong device: {trimmedData}"));
                    return;
                }
                if (trimmedData == "P")
                {
                    _logger.LogWarning("Pendant ping detected on CNC port, disconnecting (wrong device)");
                    OnConnectionLost(new InvalidOperationException("Wrong device: pendant"));
                    return;
                }
            }

            // Try greeting detection — selects protocol handler and starts polling
            if (!_hasReceivedGreeting)
                TryDetectGreeting(trimmedData);

            // Delegate to active protocol handler for controller-specific messages
            if (_activeProtocol is not null && _activeProtocol.TryHandleData(trimmedData, _lastStatus, out var stateChanged))
            {
                if (stateChanged)
                    StatusReportReceived?.Invoke(_lastStatus);
                var sourceId = GetActiveSourceId();
                DataReceived?.Invoke(trimmedData, sourceId);
                return;
            }

            // Don't broadcast unrecognized data during verification (boot garbage from
            // wrong device, ESP32 boot log, etc.). Only broadcast after greeting is confirmed.
            if (_hasReceivedGreeting)
            {
                LogControllerData(trimmedData);
                var sid = GetActiveSourceId();
                DataReceived?.Invoke(trimmedData, sid);
            }
        }
    }

    private void TryDetectGreeting(string line)
    {
        foreach (var handler in _protocolHandlers)
        {
            if (!handler.MatchesGreeting(line)) continue;

            _hasReceivedGreeting = true;
            _greetingMessage = line;
            _activeProtocol = handler;
            _verificationCts?.Cancel();
            _logger.LogInformation("Detected {Protocol} controller: {Greeting}", handler.Name, line);

            // Start polling now that we know what controller we're talking to
            StartPolling();
            _logger.LogInformation("Status polling started");

            // Request full status report if protocol supports it
            if (handler.FullStatusRequestByte is { } statusByte)
            {
                _ = Task.Run(async () =>
                {
                    try { await _transport!.WriteRawAsync([statusByte]); }
                    catch { /* ignore */ }
                });
            }
            return;
        }
    }

    private void HandleCommandOk()
    {
        CommandEntry? cmd;
        lock (_activeLock)
        {
            cmd = _activeCommand;
        }

        if (cmd is null)
            return;

        _pendingCommands.TryRemove(cmd.Id, out _);

        var result = new CommandResult
        {
            Id = cmd.Id,
            Command = cmd.RawCommand,
            DisplayCommand = cmd.DisplayCommand,
            Meta = cmd.Meta,
            Status = "success",
            Timestamp = DateTime.UtcNow.ToString("o")
        };

        cmd.Tcs.TrySetResult(result);
        CommandAcknowledged?.Invoke(result);

        // Track $X unlock
        if (string.Equals(cmd.RawCommand, "$X", StringComparison.OrdinalIgnoreCase))
            UnlockReceived?.Invoke();

        // G49 cancels tool length compensation
        if (cmd.RawCommand is not null && cmd.RawCommand.Contains("G49", StringComparison.OrdinalIgnoreCase))
        {
            if (_lastStatus.ToolLengthSet)
            {
                _lastStatus.ToolLengthSet = false;
                StatusReportReceived?.Invoke(_lastStatus);
            }
        }

        // G10 L2/L20 sets work coordinate offsets — refresh WCO first, then G54-G59 values
        if (cmd.RawCommand is not null && G10WcoPattern().IsMatch(cmd.RawCommand))
        {
            _logger.LogInformation("G10 L2/L20 detected - refreshing WCO then work offsets");
            // Use 0x87 (full status request) instead of '?' to guarantee WCO is included in the response
            if (_transport is not null)
                _ = Task.Run(async () => { try { await _transport.WriteRawAsync([0x87]); } catch { /* ignore */ } });
            _ = SendCommandAsync("$#", new CommandOptions { Meta = new CommandMeta { SourceId = "system" } });
        }

        // Protocol-specific: refresh G-code parser state after commands that change it
        if (cmd.RawCommand is not null && _activeProtocol?.NeedsGCodeStateRefresh(cmd.RawCommand) == true)
        {
            _ = SendCommandAsync("$G", new CommandOptions { Meta = new CommandMeta { SourceId = "system" } });
        }
    }

    private void HandleCommandError(string message, int? code)
    {
        CommandEntry? cmd;
        lock (_activeLock)
        {
            cmd = _activeCommand;
        }

        if (cmd is null)
            return;

        _pendingCommands.TryRemove(cmd.Id, out _);

        var result = new CommandResult
        {
            Id = cmd.Id,
            Command = cmd.RawCommand,
            DisplayCommand = cmd.DisplayCommand,
            Meta = cmd.Meta,
            Status = "error",
            ErrorMessage = message,
            ErrorCode = code,
            Timestamp = DateTime.UtcNow.ToString("o")
        };

        cmd.Tcs.TrySetResult(result);
        CommandAcknowledged?.Invoke(result);
    }

    private string? GetActiveSourceId()
    {
        lock (_activeLock) return _activeCommand?.Meta?.SourceId;
    }

    #endregion

    #region Status Report Parser

    internal void ParseStatusReport(string data)
    {
        // Remove < and >
        var inner = data[1..^1];
        var parts = inner.Split('|');

        var prevStatus = _lastStatus.Status;
        var hasAccessoryField = false;

        // Reset Pn and ActiveProbe each report
        _lastStatus.Pn = "";
        _lastStatus.ActiveProbe = -1;

        // First part is always the machine status
        _lastStatus.Status = parts[0].Split(':')[0];

        for (var i = 1; i < parts.Length; i++)
        {
            var colonIdx = parts[i].IndexOf(':');
            if (colonIdx < 0) continue;

            var key = parts[i][..colonIdx];
            var value = parts[i][(colonIdx + 1)..];

            switch (key)
            {
                case "Ov":
                    var ovParts = value.Split(',');
                    if (ovParts.Length >= 3)
                    {
                        if (double.TryParse(ovParts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var fr)) _lastStatus.FeedrateOverride = fr;
                        if (double.TryParse(ovParts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var rp)) _lastStatus.RapidOverride = rp;
                        if (double.TryParse(ovParts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var sp)) _lastStatus.SpindleOverride = sp;
                    }
                    break;

                case "T":
                    if (int.TryParse(value, out var tool))
                        _lastStatus.Tool = tool;
                    break;

                case "H":
                    _lastStatus.Homed = value.Contains('1');
                    break;

                case "FS":
                    var fsParts = value.Split(',');
                    if (fsParts.Length >= 1 && double.TryParse(fsParts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var feed))
                        _lastStatus.FeedRate = feed;
                    if (fsParts.Length >= 2 && double.TryParse(fsParts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var targetRpm))
                        _lastStatus.SpindleRpmTarget = targetRpm;
                    if (fsParts.Length >= 3 && double.TryParse(fsParts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var actualRpm))
                        _lastStatus.SpindleRpmActual = actualRpm;
                    break;

                case "A":
                    hasAccessoryField = true;
                    if (!string.IsNullOrEmpty(value))
                    {
                        _lastStatus.SpindleActive = value.Contains('S') || value.Contains('C');
                        _lastStatus.FloodCoolant = value.Contains('F');
                        _lastStatus.MistCoolant = value.Contains('M');
                    }
                    else
                    {
                        _lastStatus.SpindleActive = false;
                        _lastStatus.FloodCoolant = false;
                        _lastStatus.MistCoolant = false;
                    }
                    break;

                case "Pn":
                    _lastStatus.Pn = value;
                    break;

                case "P":
                    if (int.TryParse(value, out var probe))
                        _lastStatus.ActiveProbe = probe;
                    break;

                case "WCS":
                    _lastStatus.Workspace = value;
                    break;

                case "MPos":
                    _lastStatus.MPos = value;
                    break;

                case "WPos":
                    _lastStatus.WPos = value;
                    break;

                case "WCO":
                    _lastStatus.WCO = value;
                    break;

                case "Bf":
                    var bfParts = value.Split(',');
                    if (bfParts.Length >= 2)
                    {
                        if (int.TryParse(bfParts[0], out var b0)) _lastStatus.Bf[0] = b0;
                        if (int.TryParse(bfParts[1], out var b1)) _lastStatus.Bf[1] = b1;
                    }
                    break;

                case "Ln":
                    if (int.TryParse(value, out var ln))
                        _lastStatus.Ln = ln;
                    break;
            }
        }

        // Delegate Pn normalization to protocol handler (probe/TLS mapping)
        if (_activeProtocol is not null && _lastStatus.Pn.Length > 0)
        {
            var tlsIdx = _settings.GetSetting<int>("tlsIndex", 0);
            _lastStatus.Pn = _activeProtocol.NormalizePinState(_lastStatus.Pn, _lastStatus.ActiveProbe, tlsIdx, _lastStatus.ProbeCount);
        }

        // Compute wPos from MPos - WCO (GRBL typically only sends MPos + WCO)
        // V1 client computes work coords client-side, but we store WPos for internal use
        if (!string.IsNullOrEmpty(_lastStatus.MPos) && !string.IsNullOrEmpty(_lastStatus.WCO))
        {
            var mParts = _lastStatus.MPos.Split(',');
            var wcoParts = _lastStatus.WCO.Split(',');
            var len = Math.Min(mParts.Length, wcoParts.Length);
            var wParts = new string[len];
            for (var i = 0; i < len; i++)
            {
                if (double.TryParse(mParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var m) && double.TryParse(wcoParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var w))
                    wParts[i] = (m - w).ToString("F3", System.Globalization.CultureInfo.InvariantCulture);
                else
                    wParts[i] = "0.000";
            }
            _lastStatus.WPos = string.Join(",", wParts);
        }

        // Protocol-specific post-processing (e.g. homing detection)
        _activeProtocol?.PostProcessStatus(_lastStatus, prevStatus ?? "");

        // Preserve accessory states if A: field not present
        if (!hasAccessoryField)
        {
            // Keep existing values — they're already in _lastStatus
        }

        // Check for changes
        var hasChanges = CheckForRelevantChanges();

        if (hasChanges)
            StatusReportReceived?.Invoke(_lastStatus);
    }

    // Track previous values for change detection
    private readonly Dictionary<string, string> _prevFieldValues = new();

    private bool CheckForRelevantChanges()
    {
        var hasChanges = false;
        List<string>? watchedChanges = null;

        foreach (var field in RelevantFields)
        {
            var currentValue = GetFieldValueString(field);
            if (!_prevFieldValues.TryGetValue(field, out var prevValue) || prevValue != currentValue)
            {
                hasChanges = true;

                // Log watched field transitions (skip noisy position/feed data)
                if (prevValue is not null && Array.IndexOf(WatchedStatusFields, field) >= 0)
                {
                    watchedChanges ??= [];
                    watchedChanges.Add($"{field}: \"{prevValue}\" → \"{currentValue}\"");
                }

                _prevFieldValues[field] = currentValue;
            }
        }

        // Also check position strings (MPos, WCO)
        if (!_prevFieldValues.TryGetValue("MPos", out var prevMPos) || prevMPos != _lastStatus.MPos)
        {
            hasChanges = true;
            _prevFieldValues["MPos"] = _lastStatus.MPos;
        }

        if (!_prevFieldValues.TryGetValue("WCO", out var prevWco) || prevWco != _lastStatus.WCO)
        {
            hasChanges = true;
            _prevFieldValues["WCO"] = _lastStatus.WCO;
        }

        var bfStr = string.Join(",", _lastStatus.Bf);
        if (!_prevFieldValues.TryGetValue("Bf", out var prevBf) || prevBf != bfStr)
        {
            hasChanges = true;
            _prevFieldValues["Bf"] = bfStr;
        }

        if (watchedChanges is { Count: > 0 })
        {
            _logger.LogInformation("[STATUS REPORT]\n    Changes: [{Changes}]\n    Raw: {Raw}",
                string.Join(", ", watchedChanges), _rawStatusData);
        }

        return hasChanges;
    }

    private string GetFieldValueString(string field)
    {
        return field switch
        {
            "ActiveProbe" => _lastStatus.ActiveProbe.ToString(),
            "Status" => _lastStatus.Status,
            "FeedRate" => _lastStatus.FeedRate.ToString("F1", System.Globalization.CultureInfo.InvariantCulture),
            "SpindleRpmTarget" => _lastStatus.SpindleRpmTarget.ToString("F1", System.Globalization.CultureInfo.InvariantCulture),
            "SpindleRpmActual" => _lastStatus.SpindleRpmActual.ToString("F1", System.Globalization.CultureInfo.InvariantCulture),
            "FeedrateOverride" => _lastStatus.FeedrateOverride.ToString("F0", System.Globalization.CultureInfo.InvariantCulture),
            "RapidOverride" => _lastStatus.RapidOverride.ToString("F0", System.Globalization.CultureInfo.InvariantCulture),
            "SpindleOverride" => _lastStatus.SpindleOverride.ToString("F0", System.Globalization.CultureInfo.InvariantCulture),
            "Tool" => _lastStatus.Tool.ToString(),
            "ToolLengthSet" => _lastStatus.ToolLengthSet.ToString(),
            "Homed" => _lastStatus.Homed.ToString(),
            "Pn" => _lastStatus.Pn,
            "SpindleActive" => _lastStatus.SpindleActive.ToString(),
            "FloodCoolant" => _lastStatus.FloodCoolant.ToString(),
            "MistCoolant" => _lastStatus.MistCoolant.ToString(),
            "Workspace" => _lastStatus.Workspace,
            _ => ""
        };
    }

    private void ParseGCodeModes(string data)
    {
        // [GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]
        var content = data[4..^1];
        var modes = content.Split(' ');
        var hasChanges = false;

        var wcsMode = Array.Find(modes, m => m is "G54" or "G55" or "G56" or "G57" or "G58" or "G59");
        if (wcsMode is not null && _lastStatus.Workspace != wcsMode)
        {
            _lastStatus.Workspace = wcsMode;
            hasChanges = true;
        }

        var toolMode = Array.Find(modes, m => m.Length >= 2 && m[0] == 'T' && char.IsDigit(m[1]));
        if (toolMode is not null && int.TryParse(toolMode[1..], out var toolNumber))
        {
            if (_lastStatus.Tool != toolNumber)
            {
                _lastStatus.Tool = toolNumber;
                hasChanges = true;
            }
        }

        if (hasChanges)
            StatusReportReceived?.Invoke(_lastStatus);
    }

    private void ParseWorkOffset(string data)
    {
        // [G54:0.000,0.000,0.000,0.000]
        if (data.Length < 7) return;
        var workspace = data[1..4]; // "G54" through "G59"
        var value = data[5..^1];    // coordinates after ':'

        var prev = workspace switch
        {
            "G54" => _lastStatus.G54,
            "G55" => _lastStatus.G55,
            "G56" => _lastStatus.G56,
            "G57" => _lastStatus.G57,
            "G58" => _lastStatus.G58,
            "G59" => _lastStatus.G59,
            _ => null
        };

        if (prev == value) return;

        // If the active workspace offset changed, update WCO to stay in sync.
        // WCO = workspaceOffset + G92 + TLO. The G92+TLO portion is unchanged,
        // so newWCO = newOffset + (oldWCO - oldOffset).
        // This prevents stale WCO on controllers that don't report WCO every cycle (e.g. FluidNC).
        if (prev is not null && workspace == _lastStatus.Workspace
            && !string.IsNullOrEmpty(_lastStatus.WCO))
        {
            var prevParts = prev.Split(',');
            var newParts = value.Split(',');
            var wcoParts = _lastStatus.WCO.Split(',');
            var len = Math.Min(Math.Min(prevParts.Length, newParts.Length), wcoParts.Length);
            var updatedWco = new string[wcoParts.Length];
            Array.Copy(wcoParts, updatedWco, wcoParts.Length);
            for (var i = 0; i < len; i++)
            {
                if (double.TryParse(prevParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var oldVal)
                    && double.TryParse(newParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var newVal)
                    && double.TryParse(wcoParts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var wcoVal))
                {
                    updatedWco[i] = (wcoVal + (newVal - oldVal)).ToString("F3", CultureInfo.InvariantCulture);
                }
            }
            _lastStatus.WCO = string.Join(",", updatedWco);
        }

        switch (workspace)
        {
            case "G54": _lastStatus.G54 = value; break;
            case "G55": _lastStatus.G55 = value; break;
            case "G56": _lastStatus.G56 = value; break;
            case "G57": _lastStatus.G57 = value; break;
            case "G58": _lastStatus.G58 = value; break;
            case "G59": _lastStatus.G59 = value; break;
        }

        StatusReportReceived?.Invoke(_lastStatus);
    }

    private void TrackOutputPinCommand(string command)
    {
        // M64 Pn — turn ON output pin n
        var m64Match = M64Pattern().Match(command);
        if (m64Match.Success)
        {
            var pinNumber = int.Parse(m64Match.Groups[1].Value);
            if (!_lastStatus.OutputPinsState.Contains(pinNumber))
            {
                _lastStatus.OutputPinsState = [.. _lastStatus.OutputPinsState, pinNumber];
                _lastStatus.OutputPinsState.Sort();
                _logger.LogInformation("Output pin {Pin} turned ON via M64", pinNumber);
                StatusReportReceived?.Invoke(_lastStatus);
            }
            return;
        }

        // M65 Pn — turn OFF output pin n
        var m65Match = M65Pattern().Match(command);
        if (m65Match.Success)
        {
            var pinNumber = int.Parse(m65Match.Groups[1].Value);
            if (_lastStatus.OutputPinsState.Contains(pinNumber))
            {
                _lastStatus.OutputPinsState = _lastStatus.OutputPinsState.Where(p => p != pinNumber).ToList();
                _logger.LogInformation("Output pin {Pin} turned OFF via M65", pinNumber);
                StatusReportReceived?.Invoke(_lastStatus);
            }
        }
    }

    #endregion

    #region Status Polling

    private void StartPolling()
    {
        if (_pollTimer is not null) return;

        var interval = _settings.GetSetting<int>("pollingInterval", 100);
        if (interval < 10) interval = 100;

        _pollCts = new CancellationTokenSource();
        _pollTimer = new PeriodicTimer(TimeSpan.FromMilliseconds(interval));
        _pollTask = PollLoopAsync(_pollCts.Token);
    }

    private void StopPolling()
    {
        _pollCts?.Cancel();
        _pollTimer?.Dispose();
        _pollTimer = null;

        if (_pollTask is not null)
        {
            try { _pollTask.Wait(TimeSpan.FromSeconds(2)); }
            catch { /* best effort */ }
        }

        _pollCts?.Dispose();
        _pollCts = null;
        _pollTask = null;
    }

    private async Task PollLoopAsync(CancellationToken ct)
    {
        try
        {
            while (await _pollTimer!.WaitForNextTickAsync(ct))
            {
                if (_transport is null || (!IsConnected && !_isVerifying))
                    continue;

                try
                {
                    await SendCommandAsync("?", new CommandOptions { Meta = new CommandMeta { SourceId = "system" } });
                }
                catch
                {
                    // Polling failure — continue
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    #endregion

    private class CommandEntry
    {
        public string Id { get; init; } = "";
        public string RawCommand { get; init; } = "";
        public string CommandToWrite { get; init; } = "";
        public bool PrependJogCancel { get; init; }
        public CommandMeta? Meta { get; init; }
        public string? DisplayCommand { get; init; }
        public TaskCompletionSource<CommandResult> Tcs { get; init; } = null!;
    }
}
