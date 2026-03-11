using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.CommandHistory;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class CommandHistoryEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/command-history", (ICommandHistoryService svc) =>
        {
            return Results.Ok(svc.GetHistory());
        });

        app.MapPost("/api/command-history", async (HttpContext context, ICommandHistoryService svc, ILogger<CommandHistoryService> logger) =>
        {
            var body = await context.Request.ReadFromJsonAsync<CommandHistoryRequest>();
            if (body is null || string.IsNullOrWhiteSpace(body.Command))
                return Results.BadRequest("Command is required");

            logger.LogInformation("Adding command to history: {Command}", body.Command);
            await svc.AddCommandAsync(body.Command);
            return Results.Ok(new ApiSuccess(true));
        });
    }

}
