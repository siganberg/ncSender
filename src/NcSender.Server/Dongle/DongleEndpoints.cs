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
    // Last "$LICENSE" failure reported, so repeat polls of the same fault stay quiet.
    private static string? _lastLicenseError;

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
            var image = ms.ToArray();

            // Refuse an image that says it belongs to a different accessory.
            //
            // Every ncSender firmware carries an "NCSENDER-FW-ID:<id>:" marker.
            // This check exists because the dongle, pendant, xProbe and
            // AutoDustBoot are all ESP32-S3: a mismatched image passes the
            // header check the DEVICE makes and boots as the wrong product,
            // leaving — for instance — a Wireless USB that relays nothing and
            // reports no error. A filename cannot be trusted for this; the
            // image's own content can.
            //
            // An image with NO marker is allowed through: firmware built before
            // markers existed is legitimate, and refusing it would block the
            // very recovery path this feature is for. Only a marker naming a
            // DIFFERENT accessory is a refusal.
            var claims = NcSender.Server.Accessories.AccessoryCatalog.IdentifyImage(image);
            var expected = string.Equals(name, DongleOtaService.SelfDeviceName,
                                         StringComparison.OrdinalIgnoreCase)
                ? NcSender.Server.Accessories.AccessoryCatalog.WirelessUsbId
                : name;
            if (claims is not null && !string.Equals(claims, expected, StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new ApiError(
                    $"That firmware is for the {claims}, not the {expected}. " +
                    "Flashing it would leave this device running the wrong product."));

            _ = Task.Run(async () => {
                try { await ota.FlashAsync(name, image, deviceId, CancellationToken.None); }
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
        app.MapGet("/api/dongle/license", async (IPendantManager pendant, ILoggerFactory loggerFactory) =>
        {
            try
            {
                var status = await pendant.GetDongleLicenseAsync();
                _lastLicenseError = null;   // so the next fault logs even if it repeats an old one
                return Results.Ok(status);
            }
            catch (Exception ex)
            {
                // The dialog polls this every 3s and renders any failure as a flat
                // "Not connected", so the reason has to reach the log or the whole
                // failure is invisible. A timeout here means the dongle handle is
                // open but nothing is answering behind it.
                // Deduped on the message so a 3s poll against a wedged dongle
                // logs once, not twenty times a minute.
                if (Interlocked.Exchange(ref _lastLicenseError, ex.Message) != ex.Message)
                    loggerFactory.CreateLogger("DongleEndpoints")
                        .LogWarning(ex, "Wireless USB license query failed");
                return Results.BadRequest(new ApiError(ex.Message));
            }
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
