using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Probing;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class ProbeEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/api/probe/start", async (ProbeStartRequest request, IProbeService svc) =>
        {
            try
            {
                await svc.StartAsync(request.Options ?? request.ExtensionData, request.Commands);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/probe/stop", (IProbeService svc) =>
        {
            svc.Stop();
            return Results.Ok(new ApiSuccess(true));
        });
    }
}
