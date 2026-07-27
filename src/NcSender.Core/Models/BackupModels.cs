namespace NcSender.Core.Models;

/// <summary>
/// Which "buckets" of user data to include in an export. A bucket is a
/// coherent slice (e.g. everything macro-related, everything tool-related);
/// each is copied atomically as a group during import.
///
/// The five always-on buckets (settings, tools, macros, plugin registry,
/// plugin config) travel together because they lose meaning in isolation —
/// e.g. plugin config without the plugin registry state is orphaned. The
/// three opt-in buckets (plugin code, command history, gcode files) are
/// off by default because they're large or privacy-sensitive.
/// </summary>
public class BackupOptions
{
    /// <summary>
    /// Include installed plugin code (the plugins/ directory). Off by
    /// default — plugins can be reinstalled from the registry on the new
    /// machine, and the code is often the largest bucket.
    /// </summary>
    public bool IncludePluginsCode { get; set; }

    /// <summary>
    /// Include command history. Off by default because it can contain
    /// operator commands the user may not want moved (e.g. probes,
    /// experiments).
    /// </summary>
    public bool IncludeCommandHistory { get; set; }

    /// <summary>
    /// Include G-code files (the gcode-files/ directory). Off by default
    /// because typical libraries are many gigabytes and users can
    /// re-upload the specific files they need.
    /// </summary>
    public bool IncludeGcodeFiles { get; set; }
}

/// <summary>
/// The manifest.json placed at the root of a backup zip. Only the schema
/// version and buckets list are load-bearing for import; the rest is
/// informational so users can inspect a backup before restoring.
/// </summary>
public class BackupManifest
{
    /// <summary>Bump when the on-disk shape changes in a non-backwards-compatible way.</summary>
    public int SchemaVersion { get; set; } = 1;

    /// <summary>App version that produced the backup (e.g. "2.0.64").</summary>
    public string SourceAppVersion { get; set; } = "";

    /// <summary>"community" or "pro" — advisory only; imports are cross-edition compatible.</summary>
    public string SourceEdition { get; set; } = "";

    /// <summary>ISO-8601 UTC timestamp when the backup was created.</summary>
    public string CreatedAt { get; set; } = "";

    /// <summary>Hostname the backup came from — helps distinguish backups when a user has several.</summary>
    public string CreatedOnHost { get; set; } = "";

    /// <summary>
    /// Which buckets are actually present in this zip. Import uses this to
    /// know which target directories to wipe before extracting — bucket
    /// keys not in this list are left untouched on the destination.
    /// Values are from a fixed vocabulary: "settings", "tools", "macros",
    /// "plugin-registry", "plugin-config", "plugins-code", "command-history",
    /// "gcode-files".
    /// </summary>
    public List<string> Buckets { get; set; } = new();
}

/// <summary>Result of an import operation returned to the client.</summary>
public class BackupImportResult
{
    public bool Success { get; set; }

    /// <summary>Which buckets were actually restored (subset of the manifest's Buckets).</summary>
    public List<string> RestoredBuckets { get; set; } = new();

    /// <summary>Human-readable error message when Success is false.</summary>
    public string? Error { get; set; }

    /// <summary>Client should prompt the user to restart the app when true.</summary>
    public bool RestartRequired { get; set; }
}

/// <summary>Backup export request when writing to a target external drive path
/// instead of streaming to the browser. Reuses <see cref="BackupOptions"/> for
/// bucket selection.</summary>
public class BackupSaveRequest
{
    public BackupOptions Options { get; set; } = new();

    /// <summary>Directory path from <see cref="IExternalDriveService"/>
    /// browsing. Validated against IsPathOnListedDrive before writing.</summary>
    public string TargetPath { get; set; } = "";

    /// <summary>Optional filename override chosen by the user in the file
    /// browser. Server sanitizes (no path separators). Defaults to the
    /// server-generated hostname+timestamp name when null/empty.</summary>
    public string? Filename { get; set; }
}

/// <summary>Kiosk restore-from-disk request. The server reads the .ncsbackup
/// straight off the external drive instead of receiving an upload.</summary>
public class BackupImportFromPathRequest
{
    /// <summary>Absolute path to the .ncsbackup file — must be under a listed drive.</summary>
    public string SourcePath { get; set; } = "";
}
