using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
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
    }
}
