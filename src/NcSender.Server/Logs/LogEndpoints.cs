using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Logs;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class LogEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/logs", (ILogService svc) =>
        {
            return Results.Ok(new LogListResponse(svc.ListAsync(), PathUtils.GetLogsDir()));
        });

        app.MapGet("/api/logs/{filename}", (string filename, ILogService svc) =>
        {
            var content = svc.ReadAsync(filename);
            return content is not null
                ? Results.Ok(new LogContentResponse(filename, content))
                : Results.NotFound(new ApiError($"Log file '{filename}' not found"));
        });

        app.MapDelete("/api/logs/{filename}", (string filename, ILogService svc) =>
        {
            var success = svc.DeleteLog(filename);
            return success
                ? Results.Ok(new ApiSuccessMessage(true, $"Log file '{filename}' deleted"))
                : Results.NotFound(new ApiError($"Log file '{filename}' not found"));
        });

        app.MapGet("/api/logs/{filename}/download", (string filename, ILogService svc) =>
        {
            var path = svc.GetFilePath(filename);
            if (path is null)
                return Results.NotFound(new ApiError($"Log file '{filename}' not found"));

            var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            return Results.File(stream, "text/plain", filename);
        });

        // Kiosk / external-drive save: copies the log file to a listed drive so
        // it can be retrieved without a browser download prompt.
        app.MapPost("/api/logs/{filename}/save", async (
            string filename,
            LogSaveRequest req,
            ILogService svc,
            IExternalDriveService drives,
            ILogger<ILogService> logger) =>
        {
            if (string.IsNullOrWhiteSpace(req?.TargetPath))
                return Results.BadRequest(new ApiError("Target path is required."));
            if (!drives.IsPathOnListedDrive(req.TargetPath))
                return Results.BadRequest(new ApiError("Target path is not a recognized external drive."));

            var source = svc.GetFilePath(filename);
            if (source is null)
                return Results.NotFound(new ApiError($"Log file '{filename}' not found"));

            // Allow the client to override the destination filename (e.g. the
            // user renamed it in the file browser). Falls back to the original
            // log name when not provided. Path components are stripped.
            var destName = string.IsNullOrWhiteSpace(req.Filename)
                ? Path.GetFileName(filename)
                : Path.GetFileName(req.Filename);
            if (string.IsNullOrWhiteSpace(destName))
                return Results.BadRequest(new ApiError("Filename is invalid."));
            var fullPath = Path.Combine(req.TargetPath, destName);
            try
            {
                await using var src = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 4096, FileOptions.Asynchronous);
                await using var dst = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous);
                await src.CopyToAsync(dst);
                return Results.Ok(new ExternalDriveWriteResult { Success = true, WrittenPath = fullPath });
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Log save to {Path} failed", fullPath);
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
    }
}

public class LogSaveRequest
{
    public string TargetPath { get; set; } = "";
    /// <summary>Optional client-chosen filename override. Server sanitizes.</summary>
    public string? Filename { get; set; }
}
