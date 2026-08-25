using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.GateDialog;

/// <summary>
/// HTTP surface for the GateDialog system.
/// - <c>POST /api/dev/gate/test</c>: dev / QA smoke test.
/// - <c>POST /api/gate/ensure-homed</c>: server-owned unhomed guard.
/// Production callers use <see cref="IGateService"/> directly from server code
/// or through the plugin bridge.
/// </summary>
[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "RDG handles endpoint AOT compat")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "RDG handles endpoint AOT compat")]
public static class GateEndpoints
{
    public static void Map(WebApplication app)
    {
        // Dev / QA smoke test. ?persist=true tests restart-survival.
        app.MapPost("/api/dev/gate/test", async (IGateService gates, HttpRequest req, CancellationToken ct) =>
        {
            var persist = req.Query.TryGetValue("persist", out var p)
                          && bool.TryParse(p, out var v) && v;

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(60));

            var options = new GateOptions(
                Title: persist ? "Test gate (persisted)" : "Test gate",
                Message: persist
                    ? "Persisted GateDialog test — stop and restart the server without clicking; this prompt should reappear on the next boot."
                    : "This is a GateDialog smoke test. Click any button to close on every connected client.",
                Variant: "info",
                Buttons: new[]
                {
                    new GateButton("cancel",   "Cancel",   "secondary"),
                    new GateButton("continue", "Continue", "primary", IsDefault: true),
                },
                Source: "dev-test",
                Persist: persist);

            var value = await gates.AskAsync(options, cts.Token);
            return Results.Ok(new GateTestResponse(value ?? "(cancelled)"));
        });

        // Server-owned unhomed guard. Client fast-paths first (isHomed check +
        // blacklist), then POSTs here. Server re-checks and opens a gate if
        // needed. Deliberate CancellationToken.None on AskAsync — browser
        // refresh must not sweep a still-pending safety prompt.
        app.MapPost("/api/gate/ensure-homed", async (HttpContext ctx, IServerContext state, IGateService gates) =>
        {
            EnsureHomedRequest? req = null;
            try
            {
                req = await ctx.Request.ReadFromJsonAsync(
                    NcSenderJsonContext.Default.EnsureHomedRequest);
            }
            catch { /* empty body allowed */ }

            if (state.State.MachineState.Homed)
                return Results.Ok(new EnsureHomedResponse(true));

            if (req?.Commands is { Length: > 0 } cmds && !cmds.Any(NeedsHoming))
                return Results.Ok(new EnsureHomedResponse(true));

            var chosen = await gates.AskAsync(new GateOptions(
                Title: "Machine is not homed",
                Message: "The machine has not been homed. Running commands without homing can crash the tool. Continue anyway?",
                Variant: "danger",
                Buttons: new[]
                {
                    new GateButton("abort",    "Abort",    "secondary"),
                    new GateButton("continue", "Continue", "danger", IsDefault: true),
                },
                Source: "core:unhomed-guard",
                Key: "safety.unhomed"
            ), CancellationToken.None);

            return Results.Ok(new EnsureHomedResponse(chosen == "continue"));
        });
    }

    private static readonly Regex[] UnhomedBlacklist =
    {
        new(@"\bM0*6\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\$TLS\b",  RegexOptions.IgnoreCase | RegexOptions.Compiled),
    };

    private static bool NeedsHoming(string cmd) =>
        !string.IsNullOrWhiteSpace(cmd) && UnhomedBlacklist.Any(r => r.IsMatch(cmd));
}

public record GateTestResponse(string Value);
public record EnsureHomedRequest(string[]? Commands);
public record EnsureHomedResponse(bool Proceed);
