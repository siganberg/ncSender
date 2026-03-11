using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Job;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class JobEndpoints
{
    public static void Map(WebApplication app)
    {
        // Start job
        app.MapPost("/api/gcode-job", async (IJobManager jobManager) =>
        {
            try
            {
                await jobManager.StartJobAsync();
                return Results.Ok(new ApiSuccess(true));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        // Stop job: feed hold → delay → soft reset → stop
        app.MapPost("/api/gcode-job/stop", async (
            IJobManager jobManager,
            ICncController cnc,
            ISettingsManager settings) =>
        {
            if (!jobManager.HasActiveJob)
                return Results.BadRequest(new ApiError("No active job"));

            var pauseBeforeStop = settings.GetSetting<int>("pauseBeforeStop", 500);

            // Send feed hold
            await cnc.SendCommandAsync("!", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });

            // Wait before soft reset
            await Task.Delay(pauseBeforeStop);

            // Send soft reset
            await cnc.SendCommandAsync("\x18", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });

            jobManager.Stop();
            return Results.Ok(new ApiSuccess(true));
        });

        // Pause job
        app.MapPost("/api/gcode-job/pause", async (IJobManager jobManager, ICncController cnc) =>
        {
            if (!jobManager.HasActiveJob)
                return Results.BadRequest(new ApiError("No active job"));

            // Send feed hold to GRBL
            await cnc.SendCommandAsync("!", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });

            jobManager.Pause();
            return Results.Ok(new ApiSuccess(true));
        });

        // Resume job
        app.MapPost("/api/gcode-job/resume", async (IJobManager jobManager, ICncController cnc) =>
        {
            if (!jobManager.HasActiveJob)
                return Results.BadRequest(new ApiError("No active job"));

            // Send cycle resume to GRBL
            await cnc.SendCommandAsync("~", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });

            jobManager.Resume();
            return Results.Ok(new ApiSuccess(true));
        });
    }
}
