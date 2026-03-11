using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Alarms;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class AlarmEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/alarm/{id:int}", (int id, IAlarmService svc) =>
        {
            var description = svc.GetAlarm(id);
            return Results.Ok(new AlarmResponse(id, description ?? $"Unknown alarm {id}"));
        });
    }
}
