using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Firmware;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class FirmwareEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/firmware", async (HttpContext context, IFirmwareService svc) =>
        {
            var refresh = context.Request.Query.ContainsKey("refresh");
            var force = context.Request.Query.ContainsKey("force");

            if (refresh || force)
            {
                var data = await svc.RefreshAsync(force);
                return Results.Ok(data ?? new Core.Models.FirmwareData());
            }

            var cached = await svc.GetCachedAsync();
            return Results.Ok(cached ?? new Core.Models.FirmwareData());
        });

        app.MapPost("/api/firmware/flash", async (
            HttpContext context,
            ICncController controller,
            IBroadcaster broadcaster,
            AutoConnectService autoConnect,
            ILogger<FirmwareService> logger) =>
        {
            var request = await context.Request.ReadFromJsonAsync(NcSenderJsonContext.Default.FirmwareFlashRequest);
            if (request is null || string.IsNullOrEmpty(request.Hex))
                return Results.BadRequest(new ApiError("HEX file content is required"));

            if (string.IsNullOrEmpty(request.Port))
                return Results.BadRequest(new ApiError("Port is required"));

            var useDfu = request.IsDFU || request.Port == "SLB_DFU";

            // Run the flash process in the background
            _ = Task.Run(async () =>
            {
                try
                {
                    await FlashFirmwareAsync(controller, broadcaster, autoConnect, logger, request.Port, request.Hex, useDfu);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Firmware flash failed");
                    await BroadcastFlashError(broadcaster, ex.Message);
                }
            });

            return Results.Ok(new FirmwareFlashResponse(true, "Flash process started", useDfu ? "DFU" : "Serial"));
        });
    }

    private static async Task FlashFirmwareAsync(
        ICncController controller,
        IBroadcaster broadcaster,
        AutoConnectService autoConnect,
        ILogger logger,
        string port,
        string hexContent,
        bool useDfu)
    {
        try
        {
            // Always inhibit auto-connect during flashing to prevent noisy reconnect attempts
            autoConnect.Inhibit();
            logger.LogInformation("Auto-connector inhibited for firmware flash");

            // For serial flashing: send $DFU while still connected, then disconnect
            if (!useDfu)
            {

                // Send $DFU command through the active connection before disconnecting
                if (controller.IsConnected)
                {
                    logger.LogInformation("Sending $DFU command through active connection...");
                    await BroadcastFlashMessage(broadcaster, "info", $"Sending $DFU command to {port}...");

                    try
                    {
                        await controller.SendCommandAsync("$DFU", new CommandOptions
                        {
                            DisplayCommand = "$DFU",
                            Meta = new CommandMeta { SourceId = "system" }
                        });
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "$DFU command send returned error (device may have reset immediately)");
                    }

                    // Give the command a moment to be sent before disconnecting
                    await Task.Delay(500);
                }

                logger.LogInformation("Disconnecting CNC controller...");
                await BroadcastFlashMessage(broadcaster, "info", "Preparing to flash - stopping connections...");
                controller.Disconnect();

                // Wait for serial port to fully release and device to enter DFU mode
                logger.LogInformation("Waiting for device to enter DFU mode...");
                await BroadcastFlashMessage(broadcaster, "info", "Waiting for device to enter DFU mode (3 seconds)...");
                await Task.Delay(3000);

                await BroadcastFlashMessage(broadcaster, "info", "Controller disconnected, starting flash...");
            }

            // Flash using native USB DFU protocol (same as V1)
            await BroadcastFlashMessage(broadcaster, "info", "Starting DFU flash...");

            using var flasher = new DfuFlasher(logger);
            await flasher.FlashAsync(
                hexContent,
                onInfo: msg => _ = BroadcastFlashMessage(broadcaster, "info", msg),
                onProgress: (value, total) =>
                {
                    var data = JsonSerializer.SerializeToElement(
                        new WsFlashProgress(value, total),
                        NcSenderJsonContext.Default.WsFlashProgress);
                    _ = broadcaster.Broadcast("flash:progress", data);
                });

            logger.LogInformation("Firmware flash completed successfully");
            await BroadcastFlashEnd(broadcaster);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Flash process error");
            await BroadcastFlashError(broadcaster, ex.Message);
        }
        finally
        {
            RestartAutoConnect(autoConnect, logger, broadcaster);
        }
    }

    private static void RestartAutoConnect(AutoConnectService autoConnect, ILogger logger, IBroadcaster broadcaster)
    {
        logger.LogInformation("Restarting auto-connector after flash...");
        _ = Task.Run(async () =>
        {
            await Task.Delay(3000);
            autoConnect.Uninhibit();
            logger.LogInformation("Auto-connector uninhibited");
            await BroadcastFlashMessage(broadcaster, "info", "Auto-reconnect enabled. Device will reconnect shortly.");
        });
    }

    private static async Task BroadcastFlashMessage(IBroadcaster broadcaster, string type, string content)
    {
        var data = JsonSerializer.SerializeToElement(
            new WsFlashMessage(type, content),
            NcSenderJsonContext.Default.WsFlashMessage);
        await broadcaster.Broadcast("flash:message", data);
    }

    private static async Task BroadcastFlashError(IBroadcaster broadcaster, string error)
    {
        var data = JsonSerializer.SerializeToElement(
            new WsFlashError(error),
            NcSenderJsonContext.Default.WsFlashError);
        await broadcaster.Broadcast("flash:error", data);
    }

    private static async Task BroadcastFlashEnd(IBroadcaster broadcaster)
    {
        var data = JsonSerializer.SerializeToElement(
            new ApiSuccess(true),
            NcSenderJsonContext.Default.ApiSuccess);
        await broadcaster.Broadcast("flash:end", data);
    }
}
