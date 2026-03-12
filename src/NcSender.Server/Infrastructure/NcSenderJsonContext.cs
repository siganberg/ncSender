using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using NcSender.Core.Models;
using NcSender.Server.Models;

namespace NcSender.Server.Infrastructure;

[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never
)]
// Primitives & collections
[JsonSerializable(typeof(Dictionary<string, string>))]
[JsonSerializable(typeof(Dictionary<string, JsonElement>))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(string[]))]
[JsonSerializable(typeof(List<int>))]
// Server state
[JsonSerializable(typeof(ServerState))]
[JsonSerializable(typeof(CommandResult))]
[JsonSerializable(typeof(SendCommandRequest))]
[JsonSerializable(typeof(SendCommandMeta))]
// Config
[JsonSerializable(typeof(ConfigResponse))]
// Firmware
[JsonSerializable(typeof(FirmwareData))]
// Tools
[JsonSerializable(typeof(ToolInfo))]
[JsonSerializable(typeof(List<ToolInfo>))]
// Macros
[JsonSerializable(typeof(MacroInfo))]
[JsonSerializable(typeof(List<MacroInfo>))]
// Plugins
[JsonSerializable(typeof(PluginManifest))]
[JsonSerializable(typeof(PluginInfo))]
[JsonSerializable(typeof(List<PluginInfo>))]
[JsonSerializable(typeof(List<PluginRegistryEntry>))]
[JsonSerializable(typeof(PluginToolMenuItem))]
[JsonSerializable(typeof(List<PluginToolMenuItem>))]
[JsonSerializable(typeof(PluginUpdateInfo))]
// Pendant
[JsonSerializable(typeof(PendantStatus))]
[JsonSerializable(typeof(PendantFirmwareInfo))]
[JsonSerializable(typeof(PendantWifiInfo))]
[JsonSerializable(typeof(PendantDeviceInfo))]
[JsonSerializable(typeof(PendantSerialConnectRequest))]
[JsonSerializable(typeof(PendantActivateWifiRequest))]
[JsonSerializable(typeof(PendantActivateUsbRequest))]
[JsonSerializable(typeof(PendantDeactivateWifiRequest))]
[JsonSerializable(typeof(NcSender.Server.Pendant.PendantClientMeta))]
// Updates
[JsonSerializable(typeof(UpdateCheckResult))]
[JsonSerializable(typeof(UpdateStatus))]
[JsonSerializable(typeof(UpdateDownloadRequest))]
// Gcode analysis
[JsonSerializable(typeof(AnalyzeLineRequest))]
[JsonSerializable(typeof(AnalyzeLineResponse))]
[JsonSerializable(typeof(StartFromLineRequest))]
[JsonSerializable(typeof(StartFromLineResponse))]
// Gcode files
[JsonSerializable(typeof(GcodeFileTree))]
// Controller files
[JsonSerializable(typeof(List<ControllerFileInfo>))]
// Probe
[JsonSerializable(typeof(ProbeStartRequest))]
// Logs
[JsonSerializable(typeof(List<LogFileInfo>))]
// SSE messages
[JsonSerializable(typeof(SseProgress))]
[JsonSerializable(typeof(SseDone))]
[JsonSerializable(typeof(SseError))]
// WebSocket broadcast messages (WsMessages.cs)
[JsonSerializable(typeof(WsClientId))]
[JsonSerializable(typeof(WsCncCommandStatus))]
[JsonSerializable(typeof(WsCncCommandError))]
[JsonSerializable(typeof(WsGcodeUpdated))]
[JsonSerializable(typeof(WsJogStarted))]
[JsonSerializable(typeof(WsJogStartFailed))]
[JsonSerializable(typeof(WsJogStopped))]
[JsonSerializable(typeof(WsPluginToolsChanged))]
[JsonSerializable(typeof(WsShowDialog))]
[JsonSerializable(typeof(WsShowModal))]
[JsonSerializable(typeof(WsDialogOptions))]
[JsonSerializable(typeof(WsRemoteControlState))]
[JsonSerializable(typeof(WsFirmwareSettingChanged))]
[JsonSerializable(typeof(WsCommandHistoryAppended))]
// Broadcast primitives
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(CncError))]
// API response records (AOT-safe replacements for anonymous types)
[JsonSerializable(typeof(ApiSuccess))]
[JsonSerializable(typeof(ApiSuccessMessage))]
[JsonSerializable(typeof(ApiError))]
[JsonSerializable(typeof(HealthResponse))]
[JsonSerializable(typeof(SerialPortItem))]
[JsonSerializable(typeof(SerialPortItem[]))]
[JsonSerializable(typeof(SettingResponse))]
[JsonSerializable(typeof(SettingsSaveResponse))]
[JsonSerializable(typeof(CncStatusResponse))]
[JsonSerializable(typeof(ConnectSuccessResponse))]
[JsonSerializable(typeof(ConnectFailResponse))]
[JsonSerializable(typeof(SendSkippedResponse))]
[JsonSerializable(typeof(SendErrorResponse))]
[JsonSerializable(typeof(InitResponse))]
[JsonSerializable(typeof(AlarmResponse))]
[JsonSerializable(typeof(UploadSuccessResponse))]
[JsonSerializable(typeof(ContentResponse))]
[JsonSerializable(typeof(MacroNextIdResponse))]
[JsonSerializable(typeof(MacroExecuteResponse))]
[JsonSerializable(typeof(LogListResponse))]
[JsonSerializable(typeof(LogContentResponse))]
[JsonSerializable(typeof(ControllerFileListResponse))]
[JsonSerializable(typeof(JobStatusResponse))]
[JsonSerializable(typeof(RotationSetResponse))]
[JsonSerializable(typeof(RotationGetResponse))]
[JsonSerializable(typeof(ToolStorageResponse))]
[JsonSerializable(typeof(PendantPortsResponse))]
[JsonSerializable(typeof(PendantSerialStatusResponse))]
[JsonSerializable(typeof(PluginHasConfigResponse))]
[JsonSerializable(typeof(ChannelResponse))]
[JsonSerializable(typeof(JsonNode))]
[JsonSerializable(typeof(JsonObject))]
[JsonSerializable(typeof(JsonArray))]
// Request DTOs (deserialized via ReadFromJsonAsync<T>)
[JsonSerializable(typeof(LoadFileRequest))]
[JsonSerializable(typeof(LoadTempRequest))]
[JsonSerializable(typeof(SaveFileRequest))]
[JsonSerializable(typeof(GcodePathRequest))]
[JsonSerializable(typeof(GcodeMoveRequest))]
[JsonSerializable(typeof(GcodeRenameRequest))]
[JsonSerializable(typeof(ControllerRunRequest))]
[JsonSerializable(typeof(ControllerSaveRequest))]
[JsonSerializable(typeof(CommandHistoryRequest))]
[JsonSerializable(typeof(PluginReorderRequest))]
[JsonSerializable(typeof(PluginInstallFromUrlRequest))]
[JsonSerializable(typeof(PluginExecuteToolMenuRequest))]
[JsonSerializable(typeof(RotationRequest))]
// Firmware flash
[JsonSerializable(typeof(FirmwareFlashRequest))]
[JsonSerializable(typeof(FirmwareFlashResponse))]
// Firmware flash WS messages
[JsonSerializable(typeof(WsFlashProgress))]
[JsonSerializable(typeof(WsFlashMessage))]
[JsonSerializable(typeof(WsFlashError))]
public partial class NcSenderJsonContext : JsonSerializerContext;

// SSE message types for AOT-safe serialization
public record SseProgress(double Progress);
public record SseDone(double Progress, bool Done);
public record SseError(string Error);
