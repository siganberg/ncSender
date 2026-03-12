using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using NcSender.Core.Models;

namespace NcSender.Server.Infrastructure;

// === Shared (high reuse) ===
public record ApiSuccess(bool Success);
public record ApiSuccessMessage(bool Success, string Message);
public record ApiError(string Error);

// === ServerBuilder ===
public record HealthResponse(string Status, string Timestamp);
public record SerialPortItem(string Path, string? Manufacturer = null);
public record SettingResponse(string Key, JsonNode? Value);
public record SettingsSaveResponse(bool Success, string Message, JsonObject Settings);
public record CncStatusResponse(bool IsConnected, string Status);
public record ConnectSuccessResponse(bool Success, string Status);
public record ConnectFailResponse(bool Success, string Error);
public record SendSkippedResponse(string Status, string? Reason);
public record SendErrorResponse(string Status, string Error);
public record InitResponse(
    JsonNode? Settings,
    List<MacroInfo> Macros,
    FirmwareData? Firmware,
    List<PluginInfo> Plugins,
    List<string> CommandHistory,
    List<ToolInfo> Tools,
    ServerState ServerState,
    bool IsKiosk,
    string ScreenRotation,
    bool IsLocal);

// === AlarmEndpoints ===
public record AlarmResponse(int Id, string Description);

// === ConfigEndpoints ===
public record ConfigResponse(string Content, bool CanSave);

// === GcodeFileEndpoints ===
public record UploadSuccessResponse(bool Success, string Filename);
public record ContentResponse(string Content);

// === MacroEndpoints ===
public record MacroNextIdResponse(int NextId, int MinId, int MaxId);
public record MacroExecuteResponse(bool Success, int LinesExecuted);

// === LogEndpoints ===
public record LogListResponse(List<LogFileInfo> Files, string LogsDir);
public record LogContentResponse(string Filename, string Content);

// === ControllerFileEndpoints ===
public record ControllerFileListResponse(List<ControllerFileInfo> Files);

// === SystemEndpoints ===
public record JobStatusResponse(bool JobLoaded,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JobInfo? Job);
public record RotationSetResponse(bool Success, string Rotation,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note = null);
public record RotationGetResponse(string Rotation);

// === ToolEndpoints ===
public record ToolStorageResponse(string StoragePath);

// === PendantEndpoints ===
public record PendantPortsResponse(List<string> Ports);
public record PendantSerialStatusResponse(bool Connected,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] PendantDeviceInfo? Device = null);

// === PluginEndpoints ===
public record PluginHasConfigResponse(bool HasConfig);

// === UpdateEndpoints ===
public record ChannelResponse(string Channel);

// === Request DTOs (moved from private nested records for AOT source-gen) ===

// GcodeFileEndpoints
public record LoadFileRequest(string? Path);
public record LoadTempRequest(string? Content, string? Filename, string? SourceFile);
public record SaveFileRequest(string? Path, string? Content);
public record GcodePathRequest(string? Path);
public record GcodeMoveRequest(string? Source, string? Destination);
public record GcodeRenameRequest(string? Path, string? NewName);

// ControllerFileEndpoints
public record ControllerRunRequest(string Name);
public record ControllerSaveRequest(string Name, string Content);

// CommandHistoryEndpoints
public record CommandHistoryRequest(string Command);

// PluginEndpoints
public record PluginReorderRequest(List<string> PluginIds);
public record PluginInstallFromUrlRequest(string Url);
public record PluginExecuteToolMenuRequest(string PluginId, string Label);

// SystemEndpoints
public record RotationRequest(string Rotation);

// FirmwareEndpoints
public record FirmwareFlashRequest(string Hex, string Port, bool IsDFU = false);
public record FirmwareFlashResponse(bool Success, string Message, string Mode);
