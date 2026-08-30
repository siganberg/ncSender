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
    }
}
