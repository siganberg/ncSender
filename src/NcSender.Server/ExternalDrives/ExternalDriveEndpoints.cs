using System.Diagnostics.CodeAnalysis;
using System.Text;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.ExternalDrives;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class ExternalDriveEndpoints
{
    public static void Map(WebApplication app)
    {
        // List drives — cheap, safe to call on every open of the picker.
        app.MapGet("/api/external-drives", (IExternalDriveService drives) =>
        {
            var list = drives.ListDrives().ToList();
            return Results.Ok(list);
        });

        // List a directory under a listed drive. Used by the kiosk file browser
        // to navigate subfolders (the OS file picker gets replaced with our own
        // touch-friendly dialog). Path is validated against IsPathOnListedDrive
        // so the browser can't escape to /etc, the OS partition, etc.
        // Optional ?ext=.ncsbackup,.bin filters files by extension; directories
        // are always returned so the user can navigate through them.
        app.MapGet("/api/external-drives/browse", (
            string path,
            string? ext,
            IExternalDriveService drives,
            ILogger<ExternalDriveService> logger) =>
        {
            if (string.IsNullOrWhiteSpace(path))
                return Results.BadRequest(new ApiError("path is required"));
            if (!drives.IsPathOnListedDrive(path))
                return Results.BadRequest(new ApiError("Path is not on a recognized external drive."));
            if (!Directory.Exists(path))
                return Results.NotFound(new ApiError($"Directory not found: {path}"));

            // Parse comma-separated extension whitelist; empty = show all files.
            var wanted = (ext ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(e => e.StartsWith('.') ? e : "." + e)
                .Select(e => e.ToLowerInvariant())
                .ToHashSet();

            var entries = new List<ExternalDriveEntry>();
            try
            {
                foreach (var dir in Directory.EnumerateDirectories(path))
                {
                    try
                    {
                        var di = new DirectoryInfo(dir);
                        if ((di.Attributes & FileAttributes.Hidden) != 0) continue;
                        if ((di.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                        entries.Add(new ExternalDriveEntry
                        {
                            Name = di.Name,
                            Path = di.FullName,
                            IsDirectory = true,
                            Size = 0,
                            ModifiedAt = di.LastWriteTimeUtc.ToString("O"),
                        });
                    }
                    catch { /* skip unreadable */ }
                }
                foreach (var file in Directory.EnumerateFiles(path))
                {
                    try
                    {
                        var fi = new FileInfo(file);
                        if ((fi.Attributes & FileAttributes.Hidden) != 0) continue;
                        if (wanted.Count > 0 && !wanted.Contains(fi.Extension.ToLowerInvariant())) continue;
                        entries.Add(new ExternalDriveEntry
                        {
                            Name = fi.Name,
                            Path = fi.FullName,
                            IsDirectory = false,
                            Size = fi.Length,
                            ModifiedAt = fi.LastWriteTimeUtc.ToString("O"),
                        });
                    }
                    catch { /* skip unreadable */ }
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Browse of {Path} failed", path);
                return Results.Problem($"Could not read directory: {ex.Message}");
            }

            // Directories first, then files — familiar file-manager ordering.
            entries.Sort((a, b) =>
            {
                if (a.IsDirectory != b.IsDirectory) return a.IsDirectory ? -1 : 1;
                return string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
            });

            return Results.Ok(new ExternalDriveBrowseResponse
            {
                Path = Path.GetFullPath(path),
                Entries = entries,
            });
        });

        // Stream a file from a listed drive back to the client. Used by the
        // kiosk file browser for open flows (firmware .hex/.bin, plugin .zip,
        // tool library .json, G-code, controller uploads) so the client can
        // reuse its existing FormData/File upload paths without needing a
        // native file picker. Path is validated against IsPathOnListedDrive.
        app.MapGet("/api/external-drives/read", (
            string path,
            IExternalDriveService drives) =>
        {
            if (string.IsNullOrWhiteSpace(path))
                return Results.BadRequest(new ApiError("path is required"));
            if (!drives.IsPathOnListedDrive(path))
                return Results.BadRequest(new ApiError("Path is not on a recognized external drive."));
            if (!File.Exists(path))
                return Results.NotFound(new ApiError($"File not found: {path}"));

            var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 81920,
                options: FileOptions.Asynchronous | FileOptions.SequentialScan);
            var fileName = Path.GetFileName(path);
            return Results.File(stream, "application/octet-stream", fileDownloadName: fileName, enableRangeProcessing: false);
        });

        // Write a text payload (firmware export, tool library JSON, etc.) to
        // a listed drive. Server enforces:
        //   1) targetPath must be under a currently-listed drive.
        //   2) filename must be a plain filename — no directory components.
        // Binary payloads (backup zips) get their own per-feature endpoint that
        // streams from disk rather than via a base64-in-JSON round-trip.
        app.MapPost("/api/external-drives/write", async (
            ExternalDriveWriteRequest req,
            IExternalDriveService drives,
            ILogger<ExternalDriveService> logger) =>
        {
            if (string.IsNullOrWhiteSpace(req.TargetPath))
                return Results.BadRequest(new ExternalDriveWriteResult { Success = false, Error = "Target path is required." });
            if (string.IsNullOrWhiteSpace(req.Filename))
                return Results.BadRequest(new ExternalDriveWriteResult { Success = false, Error = "Filename is required." });

            if (!drives.IsPathOnListedDrive(req.TargetPath))
                return Results.BadRequest(new ExternalDriveWriteResult { Success = false, Error = "Target path is not a recognized external drive." });

            // Reject any filename that tries to escape the target directory.
            var safeName = Path.GetFileName(req.Filename);
            if (safeName != req.Filename || string.IsNullOrWhiteSpace(safeName))
                return Results.BadRequest(new ExternalDriveWriteResult { Success = false, Error = "Filename must not contain path separators." });

            var fullPath = Path.Combine(req.TargetPath, safeName);
            try
            {
                await File.WriteAllTextAsync(fullPath, req.Content ?? string.Empty, Encoding.UTF8);
                logger.LogInformation("Wrote {Bytes} bytes to {Path}", (req.Content ?? "").Length, fullPath);
                return Results.Ok(new ExternalDriveWriteResult
                {
                    Success = true,
                    WrittenPath = fullPath,
                });
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to write to {Path}", fullPath);
                return Results.Ok(new ExternalDriveWriteResult
                {
                    Success = false,
                    Error = $"Could not write to the drive: {ex.Message}",
                });
            }
        });
    }
}
