using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IUpdateService
{
    Task<UpdateCheckResult> CheckAsync();
    Task DownloadAsync(bool install = false);
    Task InstallAsync();
    UpdateStatus GetStatus();
}
