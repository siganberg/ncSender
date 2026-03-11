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

// CncEventBridge: plugin:show-modal (V1 parity — self-contained HTML rendered by ModalDialog)
public record WsShowModal(string PluginId, string Content, bool Closable);

// ServerBuilder: remote-control-state
public record WsRemoteControlState(bool Enabled);

// CncEventBridge: firmware-setting-changed
public record WsFirmwareSettingChanged(string Id, string Value);

// CommandHistoryService: command-history-appended
public record WsCommandHistoryAppended(string Command);
