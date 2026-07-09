using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Devices;

/// <summary>
/// Proxy to the ncSender activation server so plugins can activate/deactivate
/// accessory licenses without knowing (or shipping) the shared <c>X-Api-Key</c>.
///
/// The plugin knows:
///   • its product string (e.g. "AutoDustBoot")
///   • the accessory's machine hash (from a $LICENSE:ID handshake)
///   • the user's installationId
///
/// The server adds the api key and forwards the request. The signed license
/// JSON comes straight back to the plugin, which then writes it to the
/// accessory (typically via a <c>$LICENSE:SET &lt;json&gt;</c> command on the
/// same port it's already using).
/// </summary>
[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class PluginLicenseEndpoints
{
    // Same endpoints + shared api key the built-in Pro / pendant activation
    // paths use. Kept in one place so any future rotation is a single edit.
    private const string ActivationUrl   = "https://franciscreation.com/api/license/activate";
    private const string DeactivationUrl = "https://franciscreation.com/api/license/deactivate";
    private const string ApiKey          = "ncsp-2025-fc-api-key";

    private const string Base = "/api/plugin-license";

    public static void Map(WebApplication app)
    {
        // POST /api/plugin-license/activate
        //   Body: { "installationId": "...", "product": "AutoDustBoot",
        //           "machineHash": "<64-hex device id from $LICENSE:ID>" }
        //   Returns: 200 + signed license JSON (opaque to the server) on
        //            success, forwarding the upstream error body otherwise.
        app.MapPost($"{Base}/activate", (HttpContext ctx, ILoggerFactory lf)
            => ProxyActivationAsync(ctx, lf, ActivationUrl, "activate"));

        // POST /api/plugin-license/deactivate
        //   Body: { "installationId": "...", "product": "AutoDustBoot",
        //           "machineHash": "..." }  (whatever the upstream requires)
        // Purely a passthrough — the server just adds the api key.
        app.MapPost($"{Base}/deactivate", (HttpContext ctx, ILoggerFactory lf)
            => ProxyActivationAsync(ctx, lf, DeactivationUrl, "deactivate"));
    }

    private static async Task<IResult> ProxyActivationAsync(
        HttpContext context, ILoggerFactory loggerFactory, string upstreamUrl, string label)
    {
        var logger = loggerFactory.CreateLogger("PluginLicenseProxy");

        // Read the incoming JSON verbatim. Rejecting garbage happens upstream —
        // we just forward.
        using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
        var body = await reader.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(body))
            return Results.BadRequest(new ApiError("Request body is required"));

        JsonObject? parsed;
        try
        {
            parsed = JsonNode.Parse(body)?.AsObject();
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new ApiError($"Invalid JSON: {ex.Message}"));
        }
        if (parsed is null)
            return Results.BadRequest(new ApiError("Request body must be a JSON object"));

        // Log which product is being activated for support diagnostics.
        var product = parsed["product"]?.GetValue<string>() ?? "(unspecified)";
        logger.LogInformation("Plugin license {Op} for product {Product}", label, product);

        try
        {
            using var http = new HttpClient();
            http.DefaultRequestHeaders.Add("X-Api-Key", ApiKey);
            using var content = new StringContent(parsed.ToJsonString(), Encoding.UTF8, "application/json");
            using var response = await http.PostAsync(upstreamUrl, content);
            var text = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Activation server returned {Status} for {Op}/{Product}: {Body}",
                    (int)response.StatusCode, label, product, text);
                return Results.Content(text, "application/json", statusCode: (int)response.StatusCode);
            }

            return Results.Content(text, "application/json");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to reach activation server for {Op}/{Product}", label, product);
            return Results.StatusCode(StatusCodes.Status502BadGateway);
        }
    }
}
