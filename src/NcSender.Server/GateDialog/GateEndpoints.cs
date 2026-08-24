using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.GateDialog;

/// <summary>
/// HTTP surface for the GateDialog system. Currently only a dev / QA hook —
/// production callers use <see cref="IGateService"/> directly from server code
/// or through the plugin bridge.
/// </summary>
[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class GateEndpoints
{
    public static void Map(WebApplication app)
    {
        // Dev / QA smoke test: opens a two-button gate on every client and
        // waits up to 60s for a response. Response body is `{ "value": "..." }`.
        // Keep this endpoint even in release builds — it costs nothing when
        // idle and gives support a way to verify a machine's clients are
        // wired end-to-end. Pass ?persist=true to test restart-survival: the
        // gate writes to disk and reappears after the server reboots (the
        // awaiting HTTP request is dead by then — response comes back only
        // if the server stays up long enough for a client to click).
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
                    new GateButton("continue", "Continue", "primary", true),
                    new GateButton("cancel",   "Cancel",   "secondary")
                },
                Source: "dev-test",
                Persist: persist);

            var value = await gates.AskAsync(options, cts.Token);
            return Results.Ok(new GateTestResponse(value ?? "(cancelled)"));
        });

        // Server-owned unhomed guard. Client sends the commands it's about to
        // run; server decides whether to block on a safety gate before letting
        // them proceed. Keyed dedup means two rapid clicks (say M6 twice) share
        // one prompt across every browser tab and the pendant.
        app.MapPost("/api/gate/ensure-homed", async (HttpContext ctx, IServerContext state, IGateService gates) =>
        {
            EnsureHomedRequest? req = null;
            try
            {
                req = await ctx.Request.ReadFromJsonAsync(
                    NcSenderJsonContext.Default.EnsureHomedRequest);
            }
            catch { /* empty body allowed — treat as "no command hint" */ }

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
                    new GateButton("continue", "Continue", "danger", true),
                    new GateButton("abort",    "Abort",    "secondary"),
                },
                Source: "core:unhomed-guard",
                Key: "safety.unhomed"
            ), CancellationToken.None);
            // ^ Deliberate: browser refresh aborts the fetch, but the gate
            // itself must survive so the refreshed tab can catch it via
            // gate:active. Key-dedup joins the fresh request to the same
            // pending TCS; whichever request resolves first is fine — the
            // other's response bytes just fall on the floor for the closed
            // socket.

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
