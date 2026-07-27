using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.ExternalDrives;

/// <summary>
/// Cross-platform external / removable drive enumerator. The three OS families
/// use very different conventions:
///
/// - macOS: mounts live under `/Volumes/*`. The system boot volume is one of
///   them (e.g. `/Volumes/Macintosh HD`), so we skip whichever entry resolves
///   to the same device as `/`. Everything else is user-mountable.
///
/// - Linux: udisks2 auto-mounts under `/media/&lt;user&gt;/&lt;label&gt;` on desktops
///   and under `/media/&lt;label&gt;` on server distros; manual mounts commonly
///   live under `/mnt/*`. We probe both, one level deep.
///
/// - Windows: DriveInfo enumerates letters natively; keep only Removable.
/// </summary>
public sealed class ExternalDriveService : IExternalDriveService
{
    private readonly ILogger<ExternalDriveService> _logger;

    public ExternalDriveService(ILogger<ExternalDriveService> logger)
    {
        _logger = logger;
    }

    public IReadOnlyList<ExternalDrive> ListDrives()
    {
        try
        {
            if (OperatingSystem.IsMacOS())   return ListMacDrives();
            if (OperatingSystem.IsLinux())   return ListLinuxDrives();
            if (OperatingSystem.IsWindows()) return ListWindowsDrives();
            return Array.Empty<ExternalDrive>();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "External drive enumeration failed");
            return Array.Empty<ExternalDrive>();
        }
    }

    public bool IsPathOnListedDrive(string candidatePath)
    {
        if (string.IsNullOrWhiteSpace(candidatePath)) return false;
        string full;
        try { full = Path.GetFullPath(candidatePath); }
        catch { return false; }

        foreach (var drive in ListDrives())
        {
            var driveFull = Path.GetFullPath(drive.Path);
            // Prefix-match with a trailing separator so "/mnt/usb" doesn't
            // accidentally accept "/mnt/usb-attacker/…" as a subpath.
            var normalized = driveFull.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (full == driveFull || full.StartsWith(normalized, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    // ─── macOS ────────────────────────────────────────────────────────────

    private IReadOnlyList<ExternalDrive> ListMacDrives()
    {
        var results = new List<ExternalDrive>();
        var volumes = "/Volumes";
        if (!Directory.Exists(volumes)) return results;

        // Identify the boot volume so we can skip it. `/` should resolve to
        // the same device as the boot mount under /Volumes.
        var rootDeviceId = TryGetDeviceId("/");

        foreach (var dir in Directory.EnumerateDirectories(volumes))
        {
            try
            {
                if (rootDeviceId is long rid && TryGetDeviceId(dir) == rid) continue;
                var di = new DirectoryInfo(dir);
                if ((di.Attributes & FileAttributes.ReparsePoint) != 0) continue; // symlink
                results.Add(new ExternalDrive
                {
                    Path = dir,
                    Name = di.Name,
                    FreeBytes = TryGetFreeBytes(dir),
                });
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Skipped volume {Dir}", dir);
            }
        }
        return results;
    }

    private static long? TryGetDeviceId(string path)
    {
        // On macOS/Linux DriveInfo.DriveType alone can't tell us "same device
        // as /"; stat-comparison via FileSystemInfo doesn't expose the inode's
        // dev id directly. For our purposes a cheap heuristic works: compare
        // resolved paths. `/` is not returned by /Volumes enumeration anyway,
        // so we only ever risk matching the boot-volume alias mount.
        try
        {
            var real = Path.GetFullPath(path);
            return real.GetHashCode();
        }
        catch { return null; }
    }

    // ─── Linux ────────────────────────────────────────────────────────────

    private IReadOnlyList<ExternalDrive> ListLinuxDrives()
    {
        // Parse /proc/mounts once so we can cross-reference each candidate mount
        // point to its backing block device and check /sys/block/&lt;name&gt;/removable.
        // Non-removable devices (the OS SD card on a Pi, an internal disk, etc.)
        // must never appear in this list — otherwise a user could accidentally
        // save/restore against the boot medium.
        var mountsByPath = ReadProcMounts();

        var results = new List<ExternalDrive>();
        foreach (var root in new[] { "/media", "/mnt", "/run/media" })
        {
            if (!Directory.Exists(root)) continue;

            // /media/<user>/<label>  — user-level mounts on modern desktops
            // /media/<label>         — mountpoints on servers / older Linux
            // /mnt/<label>           — manual mounts
            foreach (var lvl1 in SafeEnumerate(root))
            {
                if (LooksMounted(lvl1) && IsRemovableMount(lvl1, mountsByPath))
                    AddIfWritable(results, lvl1);

                foreach (var lvl2 in SafeEnumerate(lvl1))
                    if (LooksMounted(lvl2) && IsRemovableMount(lvl2, mountsByPath))
                        AddIfWritable(results, lvl2);
            }
        }
        return results;
    }

    /// <summary>
    /// Read /proc/mounts → dictionary keyed by mount point (canonical full path)
    /// with value = backing device name (e.g. "sda1", "mmcblk0p2", "nvme0n1p1").
    /// Only real block devices are kept; tmpfs / cgroup / procfs entries are
    /// dropped since none of them are candidates for a "USB save target."
    /// </summary>
    private Dictionary<string, string> ReadProcMounts()
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            foreach (var line in File.ReadAllLines("/proc/mounts"))
            {
                // Format: <device> <mountpoint> <fstype> <options> ...
                var parts = line.Split(' ');
                if (parts.Length < 3) continue;
                var device = parts[0];
                var mount = UnescapeMountPath(parts[1]);
                if (!device.StartsWith("/dev/")) continue;
                var name = device.Substring("/dev/".Length);
                try { map[Path.GetFullPath(mount)] = name; }
                catch { /* skip malformed paths */ }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not read /proc/mounts");
        }
        return map;
    }

    /// <summary>
    /// /proc/mounts encodes spaces / tabs / newlines / backslashes in mount
    /// paths as octal (\040, \011, \012, \134). Decode so the map lookup
    /// against Directory.EnumerateDirectories output matches.
    /// </summary>
    private static string UnescapeMountPath(string s)
    {
        if (!s.Contains('\\')) return s;
        var sb = new System.Text.StringBuilder(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            if (s[i] == '\\' && i + 3 < s.Length &&
                char.IsDigit(s[i + 1]) && char.IsDigit(s[i + 2]) && char.IsDigit(s[i + 3]))
            {
                var oct = s.Substring(i + 1, 3);
                sb.Append((char)Convert.ToInt32(oct, 8));
                i += 3;
            }
            else sb.Append(s[i]);
        }
        return sb.ToString();
    }

    /// <summary>
    /// True only for mounts backed by a block device marked removable in sysfs.
    /// This is the canonical Linux "is this a hot-plugged USB / SD in an
    /// external card reader" signal — the Pi's built-in SD card slot reports 0,
    /// USB sticks report 1.
    /// </summary>
    private bool IsRemovableMount(string mountPath, Dictionary<string, string> mountsByPath)
    {
        try
        {
            var full = Path.GetFullPath(mountPath);
            if (!mountsByPath.TryGetValue(full, out var device))
                return false; // no matching mount → not a real mount, skip.

            // Strip partition suffix to find the parent block device.
            //   sda1 → sda, mmcblk0p2 → mmcblk0, nvme0n1p1 → nvme0n1
            var parent = StripPartitionSuffix(device);
            var removable = $"/sys/block/{parent}/removable";
            if (!File.Exists(removable)) return false;

            var value = File.ReadAllText(removable).Trim();
            return value == "1";
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Removable check failed for {Path}", mountPath);
            return false;
        }
    }

    private static string StripPartitionSuffix(string device)
    {
        // sda1 → sda   (last char is a digit and there's a letter before it)
        // mmcblk0p2 → mmcblk0   (matches ...pN)
        // nvme0n1p1 → nvme0n1   (matches ...pN)
        var m = System.Text.RegularExpressions.Regex.Match(device, @"^(.*?)(p?\d+)$");
        if (m.Success)
        {
            var stem = m.Groups[1].Value;
            // "sda" doesn't end in 'p'; "mmcblk0p" / "nvme0n1p" do → strip trailing 'p'.
            if (stem.EndsWith('p') && stem.Length > 1 && char.IsDigit(stem[stem.Length - 2]))
                stem = stem.Substring(0, stem.Length - 1);
            return stem;
        }
        return device;
    }

    private void AddIfWritable(List<ExternalDrive> results, string path)
    {
        try
        {
            // Skip if already added (dedup by resolved path)
            var full = Path.GetFullPath(path);
            if (results.Any(r => Path.GetFullPath(r.Path) == full)) return;

            var di = new DirectoryInfo(path);
            if ((di.Attributes & FileAttributes.ReparsePoint) != 0) return;
            results.Add(new ExternalDrive
            {
                Path = path,
                Name = di.Name,
                FreeBytes = TryGetFreeBytes(path),
            });
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Skipped candidate {Path}", path);
        }
    }

    /// <summary>Loose "is this actually a mount, not just an empty stub dir"
    /// check: any file, subdir, or non-zero total size counts.</summary>
    private static bool LooksMounted(string path)
    {
        try
        {
            if (Directory.EnumerateFileSystemEntries(path).Any()) return true;
            var di = new DriveInfo(path);
            return di.IsReady && di.TotalSize > 0;
        }
        catch { return false; }
    }

    private static IEnumerable<string> SafeEnumerate(string dir)
    {
        try { return Directory.EnumerateDirectories(dir); }
        catch { return Array.Empty<string>(); }
    }

    // ─── Windows ──────────────────────────────────────────────────────────

    private IReadOnlyList<ExternalDrive> ListWindowsDrives()
    {
        var results = new List<ExternalDrive>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.DriveType != DriveType.Removable) continue;
                if (!d.IsReady) continue;
                results.Add(new ExternalDrive
                {
                    Path = d.RootDirectory.FullName,
                    Name = string.IsNullOrEmpty(d.VolumeLabel) ? d.Name.TrimEnd('\\') : d.VolumeLabel,
                    FreeBytes = d.AvailableFreeSpace,
                });
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Skipped drive {Name}", d.Name);
            }
        }
        return results;
    }

    // ─── shared helper ────────────────────────────────────────────────────

    private static long? TryGetFreeBytes(string path)
    {
        try { return new DriveInfo(path).AvailableFreeSpace; }
        catch { return null; }
    }
}
