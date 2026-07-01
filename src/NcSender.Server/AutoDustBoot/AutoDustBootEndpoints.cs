using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.AutoDustBoot;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class AutoDustBootEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/autodustboot/status", (IAutoDustBootManager adb) =>
        {
            return Results.Ok(adb.GetStatus());
        });

        // Send a raw device command over the dongle: "home", "up", "down", "stop",
        // "save", "toggle", "goto:<n>". Used by the dialog's control buttons.
        app.MapPost("/api/autodustboot/command", async (AutoDustBootCommandRequest req, IAutoDustBootManager adb) =>
        {
            if (string.IsNullOrWhiteSpace(req.Command))
                return Results.BadRequest(new ApiError("Command is required"));
            await adb.SendCommandAsync(req.Command.Trim());
            return Results.Ok(new ApiSuccess(true));
        });
    }
}
