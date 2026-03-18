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
public record PendantSettingsData(string? Theme, string? AccentColor, string? GradientColor, bool DarkMode);
public record PendantClientMeta(string ClientId, string Ip, bool IsLocal, string Product, string? DeviceId, string? Version, bool Licensed);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(PendantTypeMsg))]
[JsonSerializable(typeof(PendantTypeDataMsg))]
[JsonSerializable(typeof(PendantFlashInitMsg))]
[JsonSerializable(typeof(PendantFlashDataMsg))]
[JsonSerializable(typeof(PendantWifiConfigMsg))]
[JsonSerializable(typeof(PendantSettingsMsg))]
[JsonSerializable(typeof(PendantSettingsData))]
public partial class PendantJsonContext : JsonSerializerContext;
