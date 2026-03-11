using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Plugins;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class PluginEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/plugins", (IPluginManager plugins) =>
        {
            return Results.Ok(plugins.ListAll());
        });

        app.MapGet("/api/plugins/loaded", (IPluginManager plugins) =>
        {
            return Results.Ok(plugins.ListLoaded());
        });

        app.MapPost("/api/plugins/{pluginId}/enable", (string pluginId, IPluginManager plugins) =>
        {
            try
            {
                plugins.Enable(pluginId);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (ArgumentException ex)
            {
                return Results.NotFound(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/plugins/{pluginId}/disable", (string pluginId, IPluginManager plugins) =>
        {
            plugins.Disable(pluginId);
            return Results.Ok(new ApiSuccess(true));
        });

        app.MapPost("/api/plugins/reorder", async (HttpContext context, IPluginManager plugins) =>
        {
            var body = await context.Request.ReadFromJsonAsync<PluginReorderRequest>();
            if (body?.PluginIds is null)
                return Results.BadRequest(new ApiError("pluginIds required"));

            plugins.Reorder(body.PluginIds);
            return Results.Ok(new ApiSuccess(true));
        });

        app.MapDelete("/api/plugins/{pluginId}", (string pluginId, IPluginManager plugins) =>
        {
            try
            {
                plugins.Uninstall(pluginId);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapGet("/api/plugins/{pluginId}/settings", (string pluginId, IPluginManager plugins) =>
        {
            return Results.Ok(plugins.GetSettings(pluginId));
        });

        app.MapPut("/api/plugins/{pluginId}/settings", async (string pluginId, HttpContext context, IPluginManager plugins) =>
        {
            var settings = await context.Request.ReadFromJsonAsync(NcSenderJsonContext.Default.DictionaryStringJsonElement);
            if (settings is null)
                return Results.BadRequest(new ApiError("Invalid settings"));

            try
            {
                plugins.SaveSettings(pluginId, settings);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (ArgumentException ex)
            {
                return Results.NotFound(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/plugins/{pluginId}/reload", (string pluginId, IPluginManager plugins) =>
        {
            plugins.Reload(pluginId);
            return Results.Ok(new ApiSuccess(true));
        });

        app.MapGet("/api/plugins/tool-menu-items", (IPluginManager plugins) =>
        {
            return Results.Ok(plugins.GetToolMenuItems());
        });

        app.MapPost("/api/plugins/tool-menu-items/execute", async (
            HttpContext context, IPluginManager plugins, IBroadcaster broadcaster, ISettingsManager settings) =>
        {
            var body = await context.Request.ReadFromJsonAsync<PluginExecuteToolMenuRequest>();
            if (body?.PluginId is null || body.Label is null)
                return Results.BadRequest(new ApiError("pluginId and label required"));

            // For clientOnly tool menu items (like "open-config"), show the config dialog
            var configHtml = plugins.GetConfigUi(body.PluginId);
            if (configHtml is null)
                return Results.Ok(new ApiSuccess(true));

            var pluginSettings = plugins.GetSettings(body.PluginId);
            var serverPort = settings.GetSetting<int>("connection.serverPort", 8090);
            var initialConfigJson = JsonSerializer.Serialize(pluginSettings,
                NcSenderJsonContext.Default.DictionaryStringJsonElement);

            configHtml = configHtml
                .Replace("__SERVER_PORT__", serverPort.ToString())
                .Replace("__INITIAL_CONFIG__", initialConfigJson)
                .Replace("__TOOL_MENU_LABEL__", body.Label);

            await broadcaster.Broadcast("plugin:show-dialog", new WsShowDialog(
                body.PluginId,
                body.Label,
                configHtml,
                $"{body.PluginId}_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
                new WsDialogOptions(Size: "large")
            ), NcSenderJsonContext.Default.WsShowDialog);

            return Results.Ok(new ApiSuccess(true));
        });

        app.MapGet("/api/plugins/{pluginId}/config-ui", (string pluginId, IPluginManager plugins) =>
        {
            var html = plugins.GetConfigUi(pluginId);
            return html is not null
                ? Results.Content(html, "text/html")
                : Results.NotFound(new ApiError("No config UI found"));
        });

        app.MapGet("/api/plugins/{pluginId}/has-config", (string pluginId, IPluginManager plugins) =>
        {
            return Results.Ok(new PluginHasConfigResponse(plugins.HasConfig(pluginId)));
        });

        app.MapGet("/api/plugins/{pluginId}/icon", (string pluginId, string? file, IPluginManager plugins) =>
        {
            var iconPath = file is not null
                ? plugins.GetPluginFilePath(pluginId, file)
                : plugins.GetIconPath(pluginId);
            if (iconPath is null)
                return Results.NotFound();

            var contentType = iconPath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)
                ? "image/svg+xml"
                : iconPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
                    ? "image/png"
                    : "application/octet-stream";

            return Results.File(iconPath, contentType);
        });

        app.MapPost("/api/plugins/install", async (HttpContext context, IPluginManager plugins) =>
        {
            if (!context.Request.HasFormContentType)
                return Results.BadRequest(new ApiError("Form data required"));

            var form = await context.Request.ReadFormAsync();
            var file = form.Files.GetFile("plugin");
            if (file is null)
                return Results.BadRequest(new ApiError("No plugin file provided"));

            try
            {
                using var stream = file.OpenReadStream();
                await plugins.InstallAsync(stream, file.FileName);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/plugins/install-from-url", async (HttpContext context, IPluginManager plugins) =>
        {
            var body = await context.Request.ReadFromJsonAsync<PluginInstallFromUrlRequest>();
            if (body?.Url is null)
                return Results.BadRequest(new ApiError("url required"));

            try
            {
                await plugins.InstallFromUrlAsync(body.Url);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapGet("/api/plugins/{pluginId}/check-update", async (string pluginId, IPluginManager plugins) =>
        {
            var result = await plugins.CheckUpdateAsync(pluginId);
            return Results.Ok(result);
        });

        app.MapPost("/api/plugins/{pluginId}/update", async (string pluginId, IPluginManager plugins) =>
        {
            try
            {
                await plugins.UpdateAsync(pluginId);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapGet("/api/plugins/registry", async () =>
        {
            const string platform = "pro-v2";
            const string registryUrl = "https://raw.githubusercontent.com/siganberg/ncSender.plugins-registry/main/plugins.json";

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_registryCache is not null && now < _registryCacheExpiry)
                return Results.Ok(_registryCache);

            try
            {
                using var http = new HttpClient();
                var json = await http.GetStringAsync(registryUrl);
                var array = JsonNode.Parse(json)?.AsArray();
                if (array is null)
                    return Results.Ok(new JsonArray());

                var filtered = new JsonArray();
                foreach (var item in array)
                {
                    var platforms = item?["platforms"];
                    if (platforms?[platform] is not null)
                        filtered.Add(item!.DeepClone());
                }

                _registryCache = filtered;
                _registryCacheExpiry = now + 3600000; // 1 hour
                return Results.Ok(filtered);
            }
            catch (Exception)
            {
                return _registryCache is not null
                    ? Results.Ok(_registryCache)
                    : Results.StatusCode(502);
            }
        });
    }

    private static JsonArray? _registryCache;
    private static long _registryCacheExpiry;
}
