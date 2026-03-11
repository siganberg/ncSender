using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Nodes;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Updates;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class UpdateEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/updates/check", async (IUpdateService updates) =>
        {
            var result = await updates.CheckAsync();
            return Results.Ok(result);
        });

        app.MapPost("/api/updates/download", async (HttpContext context, IUpdateService updates) =>
        {
            var body = await context.Request.ReadFromJsonAsync<UpdateDownloadRequest>();
            try
            {
                await updates.DownloadAsync(body?.Install ?? false);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/updates/install", async (IUpdateService updates) =>
        {
            try
            {
                await updates.InstallAsync();
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapGet("/api/updates/status", (IUpdateService updates) =>
        {
            return Results.Ok(updates.GetStatus());
        });

        app.MapGet("/api/updates/channel", (ISettingsManager settings) =>
        {
            var channel = settings.GetSetting<string>("updateChannel", "stable") ?? "stable";
            return Results.Ok(new ChannelResponse(channel));
        });

        app.MapPut("/api/updates/channel", async (HttpContext context, ISettingsManager settings) =>
        {
            var body = await context.Request.ReadFromJsonAsync<JsonObject>();
            var channel = body?["channel"]?.GetValue<string>() ?? "stable";
            if (channel is not "stable" and not "development")
                channel = "stable";

            await settings.SaveSettings(new JsonObject { ["updateChannel"] = channel });
            return Results.Ok(new ChannelResponse(channel));
        });
    }
}
