namespace NcSender.Core.Models;

/// <summary>
/// A mounted external / removable drive the user can save files to. Surfaced
/// by the "Save to USB" flow when the desktop shell can't offer a native save
/// dialog (kiosk browsers on ncSenderOS, ncSender Pro OS, remote browser tabs).
/// Enumeration is platform-specific — see ExternalDriveService.
/// </summary>
public class ExternalDrive
{
    /// <summary>Absolute filesystem path to the drive root — e.g. "/Volumes/USBSTICK", "/media/root/MYDRIVE", "E:\\".</summary>
    public string Path { get; set; } = "";

    /// <summary>Human-readable label, usually the volume name / last path segment.</summary>
    public string Name { get; set; } = "";

    /// <summary>Free space in bytes, or null if the OS couldn't report it.</summary>
    public long? FreeBytes { get; set; }
}

/// <summary>
/// Client-built payload (firmware export text, tool-library JSON, etc.) that
/// the client posts to POST /api/external-drives/write so it lands on a
/// mounted drive without a native save dialog.
/// </summary>
public class ExternalDriveWriteRequest
{
    /// <summary>Drive path from IExternalDriveService.ListDrives — validated server-side.</summary>
    public string TargetPath { get; set; } = "";

    /// <summary>Suggested filename (sanitized server-side; no path components allowed).</summary>
    public string Filename { get; set; } = "";

    /// <summary>UTF-8 text content. For binary payloads use a per-feature streaming endpoint instead.</summary>
    public string Content { get; set; } = "";
}

/// <summary>Result of a write-to-external-drive operation.</summary>
public class ExternalDriveWriteResult
{
    public bool Success { get; set; }
    public string? Error { get; set; }

    /// <summary>Absolute path to the written file when Success = true.</summary>
    public string? WrittenPath { get; set; }
}

/// <summary>One entry in a directory listing returned by GET /api/external-drives/browse.</summary>
public class ExternalDriveEntry
{
    /// <summary>Filename or directory name — no path components.</summary>
    public string Name { get; set; } = "";

    /// <summary>Absolute path — safe to pass back to save / read endpoints.</summary>
    public string Path { get; set; } = "";

    /// <summary>True for a subdirectory; false for a regular file.</summary>
    public bool IsDirectory { get; set; }

    /// <summary>Size in bytes; 0 for directories.</summary>
    public long Size { get; set; }

    /// <summary>Last-modified time as ISO-8601 UTC.</summary>
    public string ModifiedAt { get; set; } = "";
}

/// <summary>Response body for GET /api/external-drives/browse.</summary>
public class ExternalDriveBrowseResponse
{
    /// <summary>The path that was listed — echoed back so the client can update its breadcrumb.</summary>
    public string Path { get; set; } = "";

    public List<ExternalDriveEntry> Entries { get; set; } = new();
}
