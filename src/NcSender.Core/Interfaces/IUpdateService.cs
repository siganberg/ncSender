using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IUpdateService
{
    Task<UpdateCheckResult> CheckAsync();
    Task DownloadAsync(bool install = false);
    Task InstallAsync();
    UpdateStatus GetStatus();

    // "Version history" feature: enumerate releases so the UI can offer
    // rollback/reinstall of a specific tag without SSH. `limit` caps the
    // returned count; 0 = no cap (use with care — GitHub pages ~30).
    Task<List<ReleaseVersion>> ListVersionsAsync(int limit = 30);

    // Download + install a specific tag (e.g. "v2.0.85"). Reuses the
    // same download/install pipeline as DownloadAsync/InstallAsync but
    // targets a release the caller names instead of the channel's
    // latest.
    Task InstallVersionAsync(string tag);
}
