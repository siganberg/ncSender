using System.Diagnostics.CodeAnalysis;

namespace NcSender.Server.MachineProfiles;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class MachineProfileEndpoints
{
    public static void Map(WebApplication app)
    {
        // ?refresh asks GitHub now instead of reusing a copy from the last day.
        app.MapGet("/api/machine-profiles", async (HttpContext context, MachineProfileService profiles) =>
        {
            var result = await profiles.GetAsync(context.Request.Query.ContainsKey("refresh"), context.RequestAborted);
            return Results.Content(result.ToJsonString(), "application/json");
        });
    }
}
