using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IBackupService
{
    /// <summary>
    /// Build a backup zip streamed to <paramref name="destination"/>.
    /// The zip contains manifest.json at the root plus one entry per
    /// included bucket. Does not seek — safe for HTTP response streams.
    /// </summary>
    Task ExportAsync(BackupOptions options, Stream destination, CancellationToken cancellationToken = default);

    /// <summary>
    /// Read a backup zip from <paramref name="source"/> and apply it to
    /// the local data directory. Wipe + replace per bucket: any bucket
    /// present in the backup replaces the destination bucket wholesale.
    /// Buckets NOT in the backup are left untouched on the destination.
    /// </summary>
    Task<BackupImportResult> ImportAsync(Stream source, CancellationToken cancellationToken = default);

    /// <summary>
    /// Suggested filename for a backup, matching the browser-download form
    /// (hostname + timestamp). Kept here so browser-download and save-to-drive
    /// paths agree on naming without duplicating the format string.
    /// </summary>
    string SuggestFilename();
}
