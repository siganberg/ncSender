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
    }
}
