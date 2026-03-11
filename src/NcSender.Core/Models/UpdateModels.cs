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
