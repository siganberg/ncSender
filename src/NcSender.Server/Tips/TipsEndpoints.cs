using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Tips;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class TipsEndpoints
{
    public static void Map(WebApplication app)
    {
        // ?refresh=1 re-fetches the remote index (rate-limited inside the
        // service); without it the merged built-in + cached list is served.
        app.MapGet("/api/tips", async (HttpContext ctx, ITipsService tips) =>
        {
            var refresh = ctx.Request.Query.TryGetValue("refresh", out var v)
                          && v.ToString() is "1" or "true";
            return Results.Ok(await tips.GetTipsAsync(refresh, ctx.RequestAborted));
        });

        app.MapGet("/api/tips/media/{id:int}", (int id, ITipsService tips, HttpContext ctx) =>
            ServeMedia(id, false, tips, ctx));

        app.MapGet("/api/tips/media/{id:int}/poster", (int id, ITipsService tips, HttpContext ctx) =>
            ServeMedia(id, true, tips, ctx));
    }

    private static async Task<IResult> ServeMedia(int id, bool poster, ITipsService tips, HttpContext ctx)
    {
        var path = await tips.GetMediaPathAsync(id, poster, ctx.RequestAborted);
        if (path is null) return Results.NotFound();
        var contentType = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            _ => "application/octet-stream"
        };
        // Cached files never change under the same name, so let the browser
        // keep them. Range processing lets <video> seek and loop cleanly.
        ctx.Response.Headers.CacheControl = "private, max-age=86400";
        return Results.File(path, contentType, enableRangeProcessing: true);
    }
}
