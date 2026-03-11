using System.Diagnostics.CodeAnalysis;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Config;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class ConfigEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/config", async (IConfigService svc) =>
        {
            try
            {
                var content = await svc.GetConfigAsync();
                if (content is null)
                    return Results.BadRequest(new ApiError("Failed to retrieve config from controller"));

                return Results.Ok(new ConfigResponse(content, svc.CanSave));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPut("/api/config", async (HttpContext context, IConfigService svc) =>
        {
            if (!svc.CanSave)
                return Results.BadRequest(new ApiError("Config upload requires ethernet or wifi connection"));

            using var reader = new StreamReader(context.Request.Body);
            var content = await reader.ReadToEndAsync();

            if (string.IsNullOrWhiteSpace(content))
                return Results.BadRequest(new ApiError("Config content is empty"));

            try
            {
                await svc.SaveConfigAsync(content);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });
    }
}
