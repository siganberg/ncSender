using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Backup;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class BackupEndpoints
{
    public static void Map(WebApplication app)
    {
        // Export: POST accepts a BackupOptions body so the client can toggle
        // opt-in buckets (plugins code, command history, g-code files).
        // Response is a .ncsbackup zip — Content-Disposition triggers a
        // browser download with a hostname/timestamp stem so multi-machine
        // backups don't collide in the Downloads folder.
        //
        // Two constraints shape the flow:
        //   1) ZipArchive.Dispose() flushes its central directory via
        //      synchronous Stream.Write, which Kestrel forbids on response
        //      bodies. So we can't write straight into Response.Body.
        //   2) With `IncludeGcodeFiles=true` the backup can be many GB. Keeping
        //      the whole thing in a MemoryStream while the client downloads is
        //      wasteful. So we write to a temp file first, then stream from
        //      disk. FileOptions.DeleteOnClose has the OS reap the file the
        //      moment the response finishes — no leftover state, no janitor
        //      thread. If the export itself fails, the catch cleans up.
        app.MapPost("/api/backup/export", async (BackupOptions? options, IBackupService backup, HttpContext ctx) =>
        {
            options ??= new BackupOptions();
            var filename = backup.SuggestFilename();
            var tempPath = Path.GetTempFileName();
            try
            {
                await using (var writeStream = new FileStream(
                    tempPath, FileMode.Create, FileAccess.Write, FileShare.None,
                    bufferSize: 4096, FileOptions.Asynchronous))
                {
                    await backup.ExportAsync(options, writeStream, ctx.RequestAborted);
                }
                var readStream = new FileStream(
                    tempPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                    bufferSize: 4096,
                    FileOptions.Asynchronous | FileOptions.DeleteOnClose);
                return Results.File(readStream, "application/zip", filename);
            }
            catch
            {
                if (File.Exists(tempPath))
                {
                    try { File.Delete(tempPath); } catch { /* best-effort */ }
                }
                throw;
            }
        });

        // Kiosk restore: import a .ncsbackup from a path on a listed external
        // drive. Server reads directly from disk instead of receiving an
        // upload — no need to shuttle a potentially-large zip through the
        // browser when the file already lives on a locally-mounted USB.
        app.MapPost("/api/backup/import-from-path", async (
            BackupImportFromPathRequest req,
            IBackupService backup,
            IExternalDriveService drives,
            HttpContext ctx) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.SourcePath))
                return Results.BadRequest(new ApiError("Source path is required."));
            if (!drives.IsPathOnListedDrive(req.SourcePath))
                return Results.BadRequest(new ApiError("Source path is not on a recognized external drive."));
            if (!File.Exists(req.SourcePath))
                return Results.NotFound(new ApiError($"Backup file not found: {req.SourcePath}"));

            await using var fs = new FileStream(
                req.SourcePath, FileMode.Open, FileAccess.Read, FileShare.Read,
                bufferSize: 4096, FileOptions.Asynchronous);
            var result = await backup.ImportAsync(fs, ctx.RequestAborted);
            return Results.Ok(result);
        });

        // Kiosk / external-drive save: writes the backup .ncsbackup directly to
        // a listed removable drive. Same content generation as /export, but the
        // stream lands on the drive instead of the response body — used when
        // the browser can't offer a native save dialog.
        app.MapPost("/api/backup/save", async (
            BackupSaveRequest req,
            IBackupService backup,
            IExternalDriveService drives,
            HttpContext ctx,
            ILogger<NcSender.Server.Backup.BackupService> logger) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.TargetPath))
                return Results.BadRequest(new ApiError("Target path is required."));

            if (!drives.IsPathOnListedDrive(req.TargetPath))
                return Results.BadRequest(new ApiError("Target path is not a recognized external drive."));

            // Use client-provided filename if present, else the server default.
            // Sanitize so no ../ traversal or nested paths sneak in — final
            // path is always `<targetPath>/<basename>`.
            var raw = string.IsNullOrWhiteSpace(req.Filename) ? backup.SuggestFilename() : req.Filename!;
            var filename = Path.GetFileName(raw);
            if (string.IsNullOrWhiteSpace(filename))
                return Results.BadRequest(new ApiError("Filename is invalid."));
            var fullPath = Path.Combine(req.TargetPath, filename);

            try
            {
                await using (var fs = new FileStream(
                    fullPath, FileMode.Create, FileAccess.Write, FileShare.None,
                    bufferSize: 4096, FileOptions.Asynchronous))
                {
                    await backup.ExportAsync(req.Options ?? new BackupOptions(), fs, ctx.RequestAborted);
                }
                logger.LogInformation("Backup written to external drive: {Path}", fullPath);
                return Results.Ok(new ExternalDriveWriteResult
                {
                    Success = true,
                    WrittenPath = fullPath,
                });
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Backup save to {Path} failed", fullPath);
                if (File.Exists(fullPath))
                {
                    try { File.Delete(fullPath); } catch { /* best-effort */ }
                }
                return Results.Ok(new ExternalDriveWriteResult
                {
                    Success = false,
                    Error = $"Could not write to the drive: {ex.Message}",
                });
            }
        });

        // Import: multipart upload with the .ncsbackup file. Always returns
        // 200 with a BackupImportResult body — success flag inside says
        // whether the swap actually happened. Client shows the RestartRequired
        // modal on success.
        app.MapPost("/api/backup/import", async (HttpContext ctx, IBackupService backup) =>
        {
            if (!ctx.Request.HasFormContentType)
                return Results.BadRequest(new ApiError("multipart/form-data required"));

            var form = await ctx.Request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ApiError("No backup file provided"));

            await using var stream = file.OpenReadStream();
            var result = await backup.ImportAsync(stream, ctx.RequestAborted);
            return Results.Ok(result);
        });
    }
}
