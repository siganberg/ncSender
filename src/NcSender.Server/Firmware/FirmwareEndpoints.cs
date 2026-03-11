using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Firmware;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class FirmwareEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/firmware", async (HttpContext context, IFirmwareService svc) =>
        {
            var refresh = context.Request.Query.ContainsKey("refresh");
            var force = context.Request.Query.ContainsKey("force");

            if (refresh || force)
            {
                var data = await svc.RefreshAsync(force);
                return Results.Ok(data ?? new Core.Models.FirmwareData());
            }

            var cached = await svc.GetCachedAsync();
            return Results.Ok(cached ?? new Core.Models.FirmwareData());
        });
    }
}
