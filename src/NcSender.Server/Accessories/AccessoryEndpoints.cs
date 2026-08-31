using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Accessories;

/// <summary>
/// The Accessories view's API: one list covering every accessory, wired or
/// wireless, with firmware state — and one way to update any of them.
/// </summary>
[System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode",
    Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode",
    Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class AccessoryEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        // GET /api/accessories?check=true
        //
        // `check` is opt-in because it reaches out to GitHub for every product.
        // The view can poll cheaply for connection state and ask for the
        // release comparison only when it is actually showing it.
        app.MapGet("/api/accessories",
            async (AccessoryService svc, HttpRequest req, CancellationToken ct) =>
        {
            var check = req.Query["check"].ToString() is "1" or "true";
            return Results.Ok(await svc.ListAsync(check, ct));
        });

        // POST /api/accessories/{id}/update
        //
        // Pushes the latest published release to the device. The transport is
        // decided downstream: the same call updates a cabled device over USB
        // and a paired one over the radio.
        app.MapPost("/api/accessories/{id}/update",
            async (string id, AccessoryService svc, NcSender.Server.Dongle.DongleOtaService ota,
                   CancellationToken ct) =>
        {
            var def = AccessoryCatalog.ById(id);
            if (def is null) return Results.NotFound(new ApiError($"Unknown accessory '{id}'"));

            var list = await svc.ListAsync(checkUpdates: true, ct);
            var info = list.FirstOrDefault(a => a.Id == def.Id);
            if (info is null || !info.Connected)
                return Results.BadRequest(new ApiError($"{def.Name} is not connected"));
            if (string.IsNullOrEmpty(info.DownloadUrl))
                return Results.BadRequest(new ApiError(
                    info.UpdateCheckError ?? $"No firmware available for {def.Name}"));

            // Fire and forget: progress and completion go out on plugin-ota:*,
            // which is the same stream the existing flashing UI already reads.
            var target = def.Id == AccessoryCatalog.WirelessUsbId
                ? NcSender.Server.Dongle.DongleOtaService.SelfDeviceName
                : def.PeerName ?? def.Id;
            _ = Task.Run(async () =>
            {
                try { await ota.FlashFromUrlAsync(target, info.DownloadUrl, info.DeviceId, CancellationToken.None); }
                catch { /* already broadcast */ }
            });
            return Results.Ok(new ApiSuccess(true));
        });

        // POST /api/accessories/{id}/activate   { installationId? }
        //
        // One activation path for every accessory. Omitting the Installation ID
        // asks the store to reactivate from the device fingerprint; that is the
        // normal case for hardware it has seen before, and it asks the user for
        // nothing. Only a device the store does not recognise comes back with
        // needsInstallationId, and only then does the view prompt.
        app.MapPost("/api/accessories/{id}/activate",
            async (string id, AccessoryActivateRequest? req, AccessoryService svc,
                   IHttpClientFactory httpFactory, CancellationToken ct) =>
        {
            var def = AccessoryCatalog.ById(id);
            if (def is null) return Results.NotFound(new ApiError($"Unknown accessory '{id}'"));
            if (def.LicenseProduct is null)
                return Results.BadRequest(new ApiError($"{def.Name} cannot be activated"));

            var list = await svc.ListAsync(checkUpdates: false, ct);
            var info = list.FirstOrDefault(a => a.Id == def.Id);
            if (info is null || !info.Connected)
                return Results.BadRequest(new ApiError($"{def.Name} is not connected"));
            if (string.IsNullOrEmpty(info.DeviceId))
                return Results.BadRequest(new ApiError(
                    $"{def.Name} did not report a device ID. Please reconnect it."));

            var http = httpFactory.CreateClient();
            var fetched = await LicenseClient.FetchAsync(
                req?.InstallationId, info.DeviceId, def.LicenseProduct, http, ct);
            if (!fetched.Ok)
            {
                if (fetched.NeedsInstallationId)
                    return Results.Ok(new AccessoryActivateResponse(false, true, fetched.Error));
                return Results.BadRequest(new ApiError(fetched.Error ?? "Activation failed"));
            }

            try
            {
                await svc.ImportLicenceAsync(def, fetched.Json, ct);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }

            svc.InvalidateLicence(def.PeerName ?? def.Id);
            return Results.Ok(new AccessoryActivateResponse(true, false, null));
        });
    }
}
