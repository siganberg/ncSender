using System.Text.Json;
using System.Text.Json.Serialization;

namespace NcSender.Server.Pendant;

// Pendant serial protocol messages (sent over USB serial to pendant hardware)
public record PendantTypeMsg(string Type);
public record PendantTypeDataMsg(string Type, JsonElement Data);
public record PendantFlashInitMsg(string Type, int Size);
public record PendantFlashDataMsg(string Type, string Data);
public record PendantWifiConfigMsg(string Type, string Ssid, string Password, string Ip, int Port);
public record PendantSettingsMsg(string Type, PendantSettingsData Data);
public record PendantSettingsData(string? Theme, string? AccentColor, string? GradientColor, bool DarkMode,
    // Mirrors the app's probe connection test. When on, the pendant keeps its
    // Start Probe control locked until the probe has actually closed once.
    bool RequireConnectionTest = false);
public record PendantClientMeta(string ClientId, string Ip, bool IsLocal, string Product, string? DeviceId, string? Version, bool Licensed);

// Pushed to the pendant when the aux I/O config changes or the
// pneumatic ATC slot count changes — also once on pendant connect so
// the Outputs screen has a full picture without polling. Live on/off
// state and the currently-loaded tool piggyback on the DRO delta.
public record PendantOutputsConfigMsg(string Type, PendantOutputsConfigData Data);
public record PendantOutputsConfigData(PendantAuxOutput[] Aux, int SlotCount);
public record PendantAuxOutput(
    string Id,
    string Name,
    string On,
    string Off,
    bool Enabled,
    bool HoldToActivate);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(PendantTypeMsg))]
[JsonSerializable(typeof(PendantTypeDataMsg))]
[JsonSerializable(typeof(PendantFlashInitMsg))]
[JsonSerializable(typeof(PendantFlashDataMsg))]
[JsonSerializable(typeof(PendantWifiConfigMsg))]
[JsonSerializable(typeof(PendantSettingsMsg))]
[JsonSerializable(typeof(PendantSettingsData))]
[JsonSerializable(typeof(PendantOutputsConfigMsg))]
[JsonSerializable(typeof(PendantOutputsConfigData))]
[JsonSerializable(typeof(PendantAuxOutput))]
[JsonSerializable(typeof(PendantAuxOutput[]))]
public partial class PendantJsonContext : JsonSerializerContext;
