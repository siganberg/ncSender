using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Updates;

public class UpdateService : IUpdateService
{
    private readonly ILogger<UpdateService> _logger;
    private readonly ISettingsManager _settings;
    private const string GitHubReleasesUrl = "https://api.github.com/repos/siganberg/ncsenderpro.releases/releases";
    private UpdateStatus _status = new();
    private string? _downloadedAssetPath;

    public UpdateService(ILogger<UpdateService> logger, ISettingsManager settings)
    {
        _logger = logger;
        _settings = settings;
    }

    public async Task<UpdateCheckResult> CheckAsync()
    {
        _status = new UpdateStatus { Phase = "checking" };

        var currentVersion = GetCurrentVersion();
        var channel = _settings.GetSetting<string>("updateChannel", "stable") ?? "stable";
        _logger.LogInformation("Update check: currentVersion={Version}, channel={Channel}", currentVersion, channel);
        var result = new UpdateCheckResult { CurrentVersion = currentVersion, Channel = channel };

        try
        {
            using var http = new HttpClient();
            http.DefaultRequestHeaders.Add("User-Agent", "ncSender");
            var json = await http.GetStringAsync(GitHubReleasesUrl);
            using var doc = JsonDocument.Parse(json);

            var targetRelease = FindTargetRelease(doc, channel);

            if (targetRelease is null)
            {
                _status = new UpdateStatus { Phase = "not-available" };
                return result;
            }

            var tagName = targetRelease.Value.GetProperty("tag_name").GetString() ?? "";
            var latestVersion = tagName.TrimStart('v');
            result.LatestVersion = latestVersion;

            var currentIsBeta = currentVersion.Contains("-beta", StringComparison.OrdinalIgnoreCase);
            if (channel == "stable" && currentIsBeta)
                result.UpdateAvailable = true;
            else
                result.UpdateAvailable = CompareVersions(latestVersion, currentVersion) > 0;
            result.ReleaseNotes = targetRelease.Value.GetProperty("body").GetString() ?? "";

            if (targetRelease.Value.TryGetProperty("published_at", out var pub))
                result.PublishedAt = DateTime.Parse(pub.GetString()!);

            result.CanInstall = CanInstallOnPlatform();

            if (targetRelease.Value.TryGetProperty("html_url", out var htmlUrl))
                result.ReleaseUrl = htmlUrl.GetString();

            _status = new UpdateStatus
            {
                Phase = result.UpdateAvailable ? "available" : "not-available"
            };

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Update check failed");
            _status = new UpdateStatus { Phase = "error", Error = ex.Message };
            result.LatestVersion = currentVersion;
            return result;
        }
    }

    public async Task DownloadAsync(bool install = false)
    {
        _status = new UpdateStatus { Phase = "downloading" };

        try
        {
            using var http = new HttpClient();
            http.DefaultRequestHeaders.Add("User-Agent", "ncSender");
            var json = await http.GetStringAsync(GitHubReleasesUrl);
            using var doc = JsonDocument.Parse(json);

            var channel = _settings.GetSetting<string>("updateChannel", "stable") ?? "stable";
            var release = FindTargetRelease(doc, channel);
            if (release is null)
                throw new InvalidOperationException("No releases found");

            var assetName = GetPlatformAssetName();
            string? downloadUrl = null;

            if (release.Value.TryGetProperty("assets", out var assets))
            {
                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.GetProperty("name").GetString() ?? "";
                    if (name.Contains(assetName, StringComparison.OrdinalIgnoreCase))
                    {
                        downloadUrl = asset.GetProperty("browser_download_url").GetString();
                        break;
                    }
                }
            }

            if (downloadUrl is null)
                throw new InvalidOperationException($"No asset found for platform: {assetName}");

            var tempPath = Path.Combine(Path.GetTempPath(), $"ncsender-update-{Guid.NewGuid():N}{Path.GetExtension(assetName)}");

            using var response = await http.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();

            var totalBytes = response.Content.Headers.ContentLength ?? 0;
            await using var contentStream = await response.Content.ReadAsStreamAsync();
            await using var fileStream = File.Create(tempPath);

            var buffer = new byte[81920];
            long bytesRead = 0;
            int read;

            while ((read = await contentStream.ReadAsync(buffer)) > 0)
            {
                await fileStream.WriteAsync(buffer.AsMemory(0, read));
                bytesRead += read;

                if (totalBytes > 0)
                {
                    _status = new UpdateStatus
                    {
                        Phase = "downloading",
                        DownloadPercent = (double)bytesRead / totalBytes * 100
                    };
                }
            }

            _downloadedAssetPath = tempPath;
            _status = new UpdateStatus { Phase = "downloaded", DownloadPercent = 100 };

            if (install)
                await InstallAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Update download failed");
            _status = new UpdateStatus { Phase = "error", Error = ex.Message };
            throw;
        }
    }

    public async Task InstallAsync()
    {
        if (_downloadedAssetPath is null || !File.Exists(_downloadedAssetPath))
            throw new InvalidOperationException("No downloaded update available");

        if (!CanInstallOnPlatform())
            throw new InvalidOperationException("Automatic install not supported on this platform");

        _status = new UpdateStatus { Phase = "installing" };

        try
        {
            if (IsDebian())
            {
                if (IsRunningAsRoot())
                    await RunProcess("dpkg", $"-i {_downloadedAssetPath}");
                else
                    await RunProcess("sudo", $"dpkg -i {_downloadedAssetPath}");
            }

            _status = new UpdateStatus { Phase = "installed" };
            _logger.LogInformation("Update installed from {Path}", _downloadedAssetPath);

            // Exit with code 42 after a short delay so Electron can relaunch with the new version
            _ = Task.Run(async () =>
            {
                await Task.Delay(2000);
                Environment.Exit(42);
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Update install failed");
            _status = new UpdateStatus { Phase = "error", Error = ex.Message };
            throw;
        }
    }

    public UpdateStatus GetStatus() => _status;

    private static JsonElement? FindTargetRelease(JsonDocument doc, string channel)
    {
        if (channel == "development")
        {
            // Find highest-version prerelease
            JsonElement? best = null;
            string bestVersion = "";
            foreach (var release in doc.RootElement.EnumerateArray())
            {
                if (release.GetProperty("draft").GetBoolean()) continue;
                if (!release.GetProperty("prerelease").GetBoolean()) continue;
                var tag = release.GetProperty("tag_name").GetString() ?? "";
                var ver = tag.TrimStart('v');
                if (best is null || CompareVersions(ver, bestVersion) > 0)
                {
                    best = release;
                    bestVersion = ver;
                }
            }
            return best;
        }

        // Stable: first non-draft, non-prerelease
        foreach (var release in doc.RootElement.EnumerateArray())
        {
            if (release.GetProperty("draft").GetBoolean()) continue;
            if (release.GetProperty("prerelease").GetBoolean()) continue;
            return release;
        }
        return null;
    }

    private static int CompareVersions(string a, string b)
    {
        static (int[] baseParts, string pre, int preNum) Parse(string v)
        {
            v = v.TrimStart('v');
            var dashIdx = v.IndexOf('-');
            var baseStr = dashIdx >= 0 ? v[..dashIdx] : v;
            var pre = dashIdx >= 0 ? v[(dashIdx + 1)..] : "";
            var baseParts = baseStr.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
            var preNum = 0;
            if (pre.Length > 0)
            {
                var match = System.Text.RegularExpressions.Regex.Match(pre, @"(\d+)$");
                if (match.Success) preNum = int.Parse(match.Groups[1].Value);
            }
            return (baseParts, pre, preNum);
        }

        var ap = Parse(a);
        var bp = Parse(b);
        var length = Math.Max(ap.baseParts.Length, bp.baseParts.Length);

        for (var i = 0; i < length; i++)
        {
            var av = i < ap.baseParts.Length ? ap.baseParts[i] : 0;
            var bv = i < bp.baseParts.Length ? bp.baseParts[i] : 0;
            if (av > bv) return 1;
            if (av < bv) return -1;
        }

        // No prerelease > has prerelease (1.0.0 > 1.0.0-beta)
        if (ap.pre.Length == 0 && bp.pre.Length > 0) return 1;
        if (ap.pre.Length > 0 && bp.pre.Length == 0) return -1;

        // Both have prerelease — compare trailing number
        if (ap.preNum > bp.preNum) return 1;
        if (ap.preNum < bp.preNum) return -1;

        return 0;
    }

    private static string GetCurrentVersion() => BuildVersion.Value;

    private static bool CanInstallOnPlatform()
    {
        return OperatingSystem.IsLinux() && IsDebian();
    }

    private static bool IsRunningAsRoot() =>
        OperatingSystem.IsLinux() && Environment.GetEnvironmentVariable("EUID") == "0"
        || (OperatingSystem.IsLinux() && Environment.UserName == "root");

    private static bool IsDebian()
    {
        if (!File.Exists("/etc/os-release")) return false;
        var content = File.ReadAllText("/etc/os-release");
        return content.Contains("debian", StringComparison.OrdinalIgnoreCase) ||
               content.Contains("ubuntu", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetPlatformAssetName()
    {
        var arch = RuntimeInformation.OSArchitecture switch
        {
            Architecture.X64 => "x64",
            Architecture.Arm64 => "arm64",
            _ => "x64"
        };

        if (OperatingSystem.IsLinux())
        {
            return $"linux_{arch}.deb";
        }

        if (OperatingSystem.IsMacOS())
            return $"macos_{arch}.dmg";

        if (OperatingSystem.IsWindows())
            return $"windows_{arch}.exe";

        return $"linux_{arch}.tar.gz";
    }

    private static async Task RunProcess(string command, string args)
    {
        var psi = new ProcessStartInfo(command, args)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {command}");
        // Must read stdout/stderr before WaitForExit to avoid pipe deadlock
        var stdout = proc.StandardOutput.ReadToEndAsync();
        var stderr = proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        await Task.WhenAll(stdout, stderr);

        if (proc.ExitCode != 0)
            throw new InvalidOperationException(
                $"{command} exited with code {proc.ExitCode}: {await stderr}");
    }
}
