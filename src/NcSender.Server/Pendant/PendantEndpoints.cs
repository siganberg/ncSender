using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Pendant;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class PendantEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/pendant/status", (IPendantManager pendant) =>
        {
            return Results.Ok(pendant.GetStatus());
        });

        app.MapPost("/api/pendant/activate-wifi", async (PendantActivateWifiRequest request, IPendantManager pendant) =>
        {
            try
            {
                await pendant.ActivateWifiAsync(request.InstallationId, request.DeviceId, request.PendantIp);
                return Results.Ok(new ApiSuccessMessage(true, "License activated successfully"));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/pendant/activate-usb", async (PendantActivateUsbRequest request, IPendantManager pendant) =>
        {
            try
            {
                await pendant.ActivateUsbAsync(request.InstallationId);
                return Results.Ok(new ApiSuccessMessage(true, "License activated successfully via USB"));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/pendant/deactivate-wifi", async (PendantDeactivateWifiRequest request, IPendantManager pendant) =>
        {
            try
            {
                await pendant.DeactivateWifiAsync(request.PendantIp);
                return Results.Ok(new ApiSuccessMessage(true, "License deactivated successfully"));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/pendant/deactivate-usb", async (IPendantManager pendant) =>
        {
            try
            {
                await pendant.DeactivateUsbAsync();
                return Results.Ok(new ApiSuccessMessage(true, "License deactivated successfully via USB"));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapGet("/api/pendant/firmware/check", async (IPendantManager pendant) =>
        {
            var result = await pendant.CheckFirmwareAsync();
            return Results.Ok(result);
        });

        // SSE for firmware update (V1-compatible event format)
        app.MapPost("/api/pendant/firmware/update", async (HttpContext context, IPendantManager pendant) =>
        {
            context.Response.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache";

            async Task SendSseAsync(string json)
            {
                await context.Response.WriteAsync($"data: {json}\n\n");
                await context.Response.Body.FlushAsync();
            }

            try
            {
                await SendSseAsync("""{"type":"progress","percent":0,"status":"Downloading firmware..."}""");

                await pendant.UpdateFirmwareAsync(async progress =>
                {
                    await SendSseAsync($$$"""{"type":"progress","percent":{{{progress}}},"status":"Flashing firmware..."}""");
                });

                await SendSseAsync("""{"type":"complete"}""");
            }
            catch (Exception ex)
            {
                var msg = JsonSerializer.Serialize(ex.Message);
                await SendSseAsync($$$"""{"type":"error","message":{{{msg}}}}""");
            }

            return Results.Empty;
        });

        // SSE for firmware flash from file (V1-compatible event format)
        app.MapPost("/api/pendant/firmware/flash-file", async (HttpContext context, IPendantManager pendant) =>
        {
            using var ms = new MemoryStream();
            await context.Request.Body.CopyToAsync(ms);

            if (ms.Length == 0)
                return Results.BadRequest(new ApiError("No firmware data received"));

            ms.Position = 0;

            context.Response.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache";

            async Task SendSseAsync(string json)
            {
                await context.Response.WriteAsync($"data: {json}\n\n");
                await context.Response.Body.FlushAsync();
            }

            try
            {
                await SendSseAsync("""{"type":"progress","percent":0,"status":"Flashing firmware..."}""");

                await pendant.FlashFileAsync(ms, async progress =>
                {
                    await SendSseAsync($$$"""{"type":"progress","percent":{{{progress}}},"status":"Flashing firmware..."}""");
                });

                await SendSseAsync("""{"type":"complete","version":"file"}""");
            }
            catch (Exception ex)
            {
                var msg = JsonSerializer.Serialize(ex.Message);
                await SendSseAsync($$$"""{"type":"error","message":{{{msg}}}}""");
            }

            return Results.Empty;
        });

        app.MapPost("/api/pendant/firmware/cancel", (IPendantManager pendant) =>
        {
            pendant.CancelFlash();
            return Results.Ok(new ApiSuccess(true));
        });

        app.MapGet("/api/pendant/wifi-info", (IPendantManager pendant) =>
        {
            var info = pendant.GetWifiInfo();
            return info is not null ? Results.Ok(info) : Results.Ok(new PendantWifiInfo());
        });

        app.MapPost("/api/pendant/push-wifi", async (PendantWifiInfo wifiInfo, IPendantManager pendant) =>
        {
            try
            {
                await pendant.PushWifiAsync(wifiInfo);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapGet("/api/pendant/serial/ports", (IPendantManager pendant) =>
        {
            return Results.Ok(new PendantPortsResponse(pendant.GetSerialPorts()));
        });

        app.MapGet("/api/pendant/serial/status", (IPendantManager pendant) =>
        {
            var status = pendant.GetSerialStatus();
            return status is not null
                ? Results.Ok(new PendantSerialStatusResponse(true, status))
                : Results.Ok(new PendantSerialStatusResponse(false));
        });

        app.MapPost("/api/pendant/serial/connect", async (PendantSerialConnectRequest request, IPendantManager pendant) =>
        {
            try
            {
                await pendant.ConnectSerialAsync(request.Port);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/pendant/serial/disconnect", async (IPendantManager pendant) =>
        {
            await pendant.DisconnectSerialAsync();
            return Results.Ok(new ApiSuccess(true));
        });

        app.MapPost("/api/pendant/dongle/unpair", async (IPendantManager pendant) =>
        {
            try
            {
                await pendant.UnpairDongleAsync();
                return Results.Ok(new ApiSuccessMessage(true, "Dongle unpaired successfully"));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });
    }
}
