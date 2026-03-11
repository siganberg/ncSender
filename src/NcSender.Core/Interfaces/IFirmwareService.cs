using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IFirmwareService
{
    Task<FirmwareData?> GetCachedAsync();
    Task<FirmwareData?> RefreshAsync(bool force = false);
    Task SaveCacheAsync();
}
