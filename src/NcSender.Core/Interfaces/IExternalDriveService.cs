using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

/// <summary>
/// Enumerates mounted external / removable drives so the client can offer a
/// "Save to USB" alternative to browser downloads on kiosk hosts. Also
/// provides path-safety helpers used by every "save to path" endpoint to
/// reject writes outside the listed drives.
/// </summary>
public interface IExternalDriveService
{
    /// <summary>
    /// Enumerate drives that look mountable/writable for a user backup.
    /// Never throws — returns an empty list if nothing is mounted or the
    /// platform can't be queried.
    /// </summary>
    IReadOnlyList<ExternalDrive> ListDrives();

    /// <summary>
    /// Verify that <paramref name="candidatePath"/> is a directory under
    /// one of the drives currently returned by ListDrives(). Uses full-path
    /// resolution to defeat "../" traversal. Every save-to-drive endpoint
    /// must call this before writing.
    /// </summary>
    bool IsPathOnListedDrive(string candidatePath);
}
