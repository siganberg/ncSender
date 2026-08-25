using NcSender.Core.Models;

namespace NcSender.Server.Infrastructure;

// WebSocket broadcast message types — replaces anonymous types for AOT compatibility

// WebSocketLayer: client-id handshake
public record WsClientId(string ClientId, bool IsLocal, bool RemoteControlEnabled, string ServerVersion);

// CommandProcessor: cnc-command / cnc-command-result status
public record WsCncCommandStatus(string Id, string Command, string DisplayCommand, string Status, string Timestamp, string SourceId);

// WebSocketLayer: cnc-command-result error
public record WsCncCommandError(string Status, string Error);

// GcodeFileService: gcode-updated
public record WsGcodeUpdated(string Filename, int TotalLines);

// JogManager: jog:started
public record WsJogStarted(string JogId);

// JogManager: jog:start-failed
public record WsJogStartFailed(string JogId, string Message);

// JogManager: jog:stopped
public record WsJogStopped(string JogId, string? Reason = null);

// PluginManager: plugins:tools-changed
public record WsPluginToolsChanged(string PluginId, bool Enabled);

// PluginEndpoints/CncEventBridge: plugin:show-dialog
public record WsShowDialog(string PluginId, string Title, string Content, string? DialogId = null, WsDialogOptions? Options = null);
public record WsDialogOptions(string? Size = null, bool? Closable = null);

// WebSocketLayer: plugin:close-dialog — broadcast to close a dialog on every
// client (multi-session sync). Fires after any client closes the dialog.
public record WsCloseDialog(string DialogId);

// CncEventBridge: plugin:show-modal (V1 parity — self-contained HTML rendered by ModalDialog)
public record WsShowModal(string PluginId, string Content, bool Closable);

// GateDialogService: server-owned blocking prompt broadcast to every client.
// Wire-compatible with browser + pendant. First responder wins; server
// broadcasts gate:close to everyone. New clients receive gate:active on
// connect handshake so a page refresh or a late pendant boot catches the
// currently-open prompt.
public record WsGateShow(
    string GateId,
    string Title,
    string? Message,
    string Variant,
    IReadOnlyList<WsGateButton> Buttons,
    string? Source = null,
    IReadOnlyList<WsGateStep>? Steps = null,
    int StepProgress = 0,
    WsGateStepConfig? StepConfig = null,
    bool MessageHtml = false);

public record WsGateButton(
    string Value,
    string Label,
    string Style = "secondary",
    bool IsDefault = false,
    bool RequiresStepsComplete = false);

public record WsGateStep(
    string Value,
    string Label,
    IReadOnlyList<string> Commands);

public record WsGateStepConfig(
    int HoldMs = 1000,
    int CountdownSec = 5,
    bool ChainSteps = false);

public record WsGateClose(string GateId, string? Value = null);

public record WsGateActive(IReadOnlyList<WsGateShow> Gates);

// ServerBuilder: remote-control-state
public record WsRemoteControlState(bool Enabled);

// CncEventBridge: firmware-setting-changed
public record WsFirmwareSettingChanged(string Id, string Value);

// CommandHistoryService: command-history-appended
public record WsCommandHistoryAppended(string Command);

// FirmwareEndpoints: flash events
public record WsFlashProgress(int Value, int Total);
public record WsFlashMessage(string Type, string Content);
public record WsFlashError(string Error);
