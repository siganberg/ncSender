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
