using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IPendantManager
{
    PendantStatus GetStatus();
    Task ActivateWifiAsync(string installationId, string deviceId, string pendantIp);
    Task ActivateUsbAsync(string installationId);
    Task DeactivateWifiAsync(string pendantIp);
    Task DeactivateUsbAsync();
    Task<PendantFirmwareInfo> CheckFirmwareAsync();
    Task UpdateFirmwareAsync(Func<double, Task>? onProgress = null);
    Task FlashFileAsync(Stream firmware, Func<double, Task>? onProgress = null);
    void CancelFlash();
    PendantWifiInfo? GetWifiInfo();
    Task PushWifiAsync(PendantWifiInfo wifiInfo);
    List<string> GetSerialPorts();
    PendantDeviceInfo? GetSerialStatus();
    Task ConnectSerialAsync(string port);
    Task DisconnectSerialAsync();
    Task UnpairDongleAsync();
    void NotifySettingsChanged();
    void StartAutoConnect();
    HashSet<string> GetOccupiedPorts();
}
