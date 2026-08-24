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
    // Snap a PNG of the pendant's current screen — used by the docs
    // pipeline. If `screen` is non-null the pendant is asked to switch
    // there first (via $SCR:<name>) so a specific screen can be captured
    // without asking the operator to tap through the UI.
    Task<byte[]> CaptureScreenAsync(string? screen, CancellationToken ct);
    void CancelFlash();
    PendantWifiInfo? GetWifiInfo();
    Task PushWifiAsync(PendantWifiInfo wifiInfo);
    List<string> GetSerialPorts();
    PendantDeviceInfo? GetSerialStatus();
    Task ConnectSerialAsync(string port);
    Task DisconnectSerialAsync();
    Task UnpairDongleAsync();
    Task<DongleLicenseStatus> GetDongleLicenseAsync();
    Task ActivateDongleAsync(string installationId);
    void NotifySettingsChanged();
    void StartAutoConnect();
    HashSet<string> GetOccupiedPorts();
}
