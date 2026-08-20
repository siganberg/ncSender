using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Dongle;

/// <summary>
/// Generic, device-agnostic REST surface for "@name"-addressed dongle accessories. Plugins
/// (opt-in accessories such as AutoDustBoot) build their UI on top of this — core ships no
/// device-specific endpoints.
/// </summary>
[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class DongleEndpoints
{
    public static void Map(WebApplication app)
    {
        // All devices seen this session (presence + raw last payload).
        app.MapGet("/api/dongle/devices", (IDongleDeviceService dongle) =>
            Results.Ok(dongle.GetDevices()));

        // A single device by name, 404 if never seen.
        app.MapGet("/api/dongle/devices/{name}", (string name, IDongleDeviceService dongle) =>
        {
            var dev = dongle.GetDevice(name);
            return dev is null ? Results.NotFound(new ApiError($"Unknown device '{name}'")) : Results.Ok(dev);
        });

        // Send a raw payload to a named device (framed as "@name payload" on the dongle).
        app.MapPost("/api/dongle/devices/{name}/send", async (string name, DongleSendRequest req, IDongleDeviceService dongle) =>
        {
            if (string.IsNullOrWhiteSpace(name))
                return Results.BadRequest(new ApiError("Device name is required"));
            if (string.IsNullOrWhiteSpace(req.Payload))
                return Results.BadRequest(new ApiError("Payload is required"));
            await dongle.SendAsync(name.Trim(), req.Payload.Trim());
            return Results.Ok(new ApiSuccess(true));
        });

        // Open the dongle's pairing window (~30s) so a new device can bind.
        app.MapPost("/api/dongle/pair", async (IDongleDeviceService dongle) =>
        {
            await dongle.OpenPairingAsync();
            return Results.Ok(new ApiSuccess(true));
        });

        // Close an open pairing window early (Cancel).
        app.MapPost("/api/dongle/pair/cancel", async (IDongleDeviceService dongle) =>
        {
            await dongle.CancelPairingAsync();
            return Results.Ok(new ApiSuccess(true));
        });

        // Forget one paired device on the dongle.
        app.MapPost("/api/dongle/devices/{name}/unpair", async (string name, IDongleDeviceService dongle) =>
        {
            if (string.IsNullOrWhiteSpace(name))
                return Results.BadRequest(new ApiError("Device name is required"));
            await dongle.UnpairAsync(name.Trim());
            return Results.Ok(new ApiSuccess(true));
        });

        // -------- Generic wireless OTA (any dongle-attached ESP-NOW device) --------
        //
        // Multipart flash: browser uploads a .bin, server streams it to the
        // device over ESP-NOW via the dongle. Progress + errors surface on the
        // same "plugin-ota:*" WS topics as the USB flash path, so plugins can
        // handle both transports with one subscription (deviceId filter).
        app.MapPost("/api/dongle/devices/{name}/ota",
            async (string name, HttpRequest req, DongleOtaService ota, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(name))
                return Results.BadRequest(new ApiError("Device name is required"));
            if (!req.HasFormContentType)
                return Results.BadRequest(new ApiError("multipart/form-data required"));
            var form = await req.ReadFormAsync(ct);
            var file = form.Files["file"];
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ApiError("A 'file' field is required"));
            var deviceId = form["deviceId"].ToString();
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms, ct);
            _ = Task.Run(async () => {
                try { await ota.FlashAsync(name, ms.ToArray(), deviceId, CancellationToken.None); }
                catch { /* already broadcast */ }
            });
            return Results.Ok(new ApiSuccess(true));
        }).DisableAntiforgery();

        // URL flash: server downloads the firmware itself (bypasses browser
        // CORS on GitHub release-asset URLs), then flashes.
        app.MapPost("/api/dongle/devices/{name}/ota-from-url",
            (string name, DongleOtaFromUrlRequest body, DongleOtaService ota) =>
        {
            if (string.IsNullOrWhiteSpace(name))
                return Results.BadRequest(new ApiError("Device name is required"));
            if (string.IsNullOrWhiteSpace(body?.DownloadUrl))
                return Results.BadRequest(new ApiError("downloadUrl is required"));
            _ = Task.Run(async () => {
                try { await ota.FlashFromUrlAsync(name, body!.DownloadUrl, body.DeviceId, CancellationToken.None); }
                catch { /* already broadcast */ }
            });
            return Results.Ok(new ApiSuccess(true));
        });

        // Abort an in-flight session for this device (idempotent).
        app.MapPost("/api/dongle/devices/{name}/ota/cancel",
            (string name, DongleOtaService ota) =>
        {
            if (string.IsNullOrWhiteSpace(name))
                return Results.BadRequest(new ApiError("Device name is required"));
            ota.Cancel(name);
            return Results.Ok(new ApiSuccess(true));
        });

        // The Wireless USB dongle's own license state (read via the "$LICENSE" line command).
        app.MapGet("/api/dongle/license", async (IPendantManager pendant) =>
        {
            try { return Results.Ok(await pendant.GetDongleLicenseAsync()); }
            catch (Exception ex) { return Results.BadRequest(new ApiError(ex.Message)); }
        });

        // Activate the dongle with an installation ID: calls the activation server, then
        // writes the signed license to the dongle over serial.
        app.MapPost("/api/dongle/activate", async (DongleActivateRequest req, IPendantManager pendant) =>
        {
            if (string.IsNullOrWhiteSpace(req.InstallationId))
                return Results.BadRequest(new ApiError("Installation ID is required"));
            try
            {
                await pendant.ActivateDongleAsync(req.InstallationId.Trim());
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });
    }
}
