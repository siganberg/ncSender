using System.Diagnostics.CodeAnalysis;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Devices;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class PluginSerialEndpoints
{
    private const string Base = "/api/plugin-serial";

    public static void Map(WebApplication app)
    {
        // Discover which USB port an accessory is on. Caller controls the
        // handshake — pass the request line + a regex for the reply, we
        // return the first port that matches.
        //
        // Example (AutoDustBoot):
        //   POST /api/plugin-serial/probe
        //   { "request": "$VERSION\n",
        //     "responsePattern": "^\\$VERSION:(\\d+\\.\\d+\\.\\d+)$",
        //     "timeoutMs": 800 }
        //   →  { "found": true, "port": "/dev/tty.usbmodem…", "match": "1.0.0" }
        app.MapPost($"{Base}/probe", async (HttpContext context, IPluginSerialService svc) =>
        {
            var req = await context.Request.ReadFromJsonAsync<PluginSerialProbeRequest>()
                      ?? new PluginSerialProbeRequest();
            var result = svc.Probe(req);
            return Results.Ok(result);
        });

        // Flash a firmware binary over serial using the ncSender $OTA:*
        // protocol. Multipart form fields: file, port, [deviceId], [baud].
        // deviceId is echoed back in the plugin-ota:* WebSocket events so
        // a plugin can filter for its own flash.
        app.MapPost($"{Base}/ota/flash", async (HttpContext context, IPluginSerialService svc, ILogger<PluginSerialService> logger) =>
        {
            if (!context.Request.HasFormContentType)
                return Results.BadRequest(new ApiError("multipart/form-data required"));

            var form = await context.Request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ApiError("No firmware file provided"));

            var port = form["port"].ToString();
            if (string.IsNullOrEmpty(port))
                return Results.BadRequest(new ApiError("`port` is required"));

            var deviceId = form["deviceId"].ToString();
            int? baud = null;
            if (int.TryParse(form["baud"].ToString(), out var b) && b > 0) baud = b;

            byte[] bytes;
            await using (var s = file.OpenReadStream())
            {
                using var ms = new MemoryStream();
                await s.CopyToAsync(ms);
                bytes = ms.ToArray();
            }

            _ = Task.Run(async () =>
            {
                try { await svc.FlashOtaAsync(port, bytes, baud, deviceId); }
                catch (Exception ex) { logger.LogError(ex, "Plugin OTA on {Port} failed", port); }
            });
            return Results.Ok(new ApiSuccess(true));
        });

        // Flash from a URL. Body: { downloadUrl, port, deviceId?, baud? }.
        // The server does the HTTP fetch so the browser doesn't have to —
        // GitHub Releases assets don't set Access-Control-Allow-Origin, so
        // a plugin-side fetch() to the asset URL fails with 'Failed to fetch'.
        // This endpoint offloads the download to the server (no CORS).
        app.MapPost($"{Base}/ota/flash-from-url",
            async (PluginOtaFromUrlRequest req, IPluginSerialService svc,
                   IHttpClientFactory httpFactory, ILogger<PluginSerialService> logger) =>
        {
            if (string.IsNullOrWhiteSpace(req.DownloadUrl))
                return Results.BadRequest(new ApiError("`downloadUrl` is required"));
            if (string.IsNullOrWhiteSpace(req.Port))
                return Results.BadRequest(new ApiError("`port` is required"));

            byte[] bytes;
            try
            {
                using var http = httpFactory.CreateClient();
                http.Timeout = TimeSpan.FromMinutes(2);
                using var resp = await http.GetAsync(req.DownloadUrl,
                    HttpCompletionOption.ResponseHeadersRead);
                resp.EnsureSuccessStatusCode();
                bytes = await resp.Content.ReadAsByteArrayAsync();
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to download firmware from {Url}", req.DownloadUrl);
                return Results.BadRequest(new ApiError("Download failed: " + ex.Message));
            }

            var port = req.Port;
            var deviceId = req.DeviceId ?? string.Empty;
            var baud = req.Baud;
            _ = Task.Run(async () =>
            {
                try { await svc.FlashOtaAsync(port, bytes, baud, deviceId); }
                catch (Exception ex) { logger.LogError(ex, "Plugin OTA on {Port} failed", port); }
            });
            return Results.Ok(new ApiSuccess(true));
        });

        // Best-effort cancel of an in-progress flash.
        app.MapPost($"{Base}/ota/cancel", (IPluginSerialService svc) =>
        {
            svc.Cancel();
            return Results.Ok(new ApiSuccess(true));
        });

        // Status of any active flash — mostly useful for a plugin that
        // re-opens its dialog mid-flash and wants to reattach the UI.
        app.MapGet($"{Base}/ota/status", (IPluginSerialService svc) =>
        {
            return Results.Ok(new PluginOtaStatus(svc.ActiveFlashPort is not null, svc.ActiveFlashPort));
        });
    }
}

public record PluginOtaStatus(bool InProgress, string? Port);

public record PluginOtaFromUrlRequest(string DownloadUrl, string Port, string? DeviceId, int? Baud);
