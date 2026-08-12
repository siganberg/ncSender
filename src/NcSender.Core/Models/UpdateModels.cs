using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

public class UpdateCheckResult
{
    public string CurrentVersion { get; set; } = "";
    public string LatestVersion { get; set; } = "";
    public bool UpdateAvailable { get; set; }
    public string ReleaseNotes { get; set; } = "";
    public DateTime? PublishedAt { get; set; }
    public bool CanInstall { get; set; }
    public string Channel { get; set; } = "stable";
    public string? ReleaseUrl { get; set; }
}

public class UpdateStatus
{
    public string Phase { get; set; } = "idle";
    public double DownloadPercent { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; set; }
}

public class UpdateDownloadRequest
{
    public bool Install { get; set; }
}

// One entry in the /api/updates/versions list. Powers the "roll back to
// a specific version" UI — kiosk users can't shell in to run dpkg, so
// the server surfaces the release history and drives the install.
public class ReleaseVersion
{
    public string Tag { get; set; } = "";
    public string Version { get; set; } = "";
    public DateTime? PublishedAt { get; set; }
    public string Notes { get; set; } = "";
    public bool IsPrerelease { get; set; }
    public bool IsCurrent { get; set; }
    public bool CanInstall { get; set; }
    public string? ReleaseUrl { get; set; }
}

public class InstallVersionRequest
{
    public string Tag { get; set; } = "";
}
