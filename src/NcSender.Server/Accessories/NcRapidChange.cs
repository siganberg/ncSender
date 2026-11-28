using System.Globalization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Accessories;

/// <summary>
/// The ncRapidChangeAir: the wireless board in a RapidChange ATC magazine. It
/// reads the tool setter and the IR beam and drives the two dust cover servos.
/// Its settings live on the device; this reads and writes them over whichever
/// link reaches it (its cable, or the radio), for the Accessories view.
///
/// Nothing here moves the cover by itself: a servo only moves when the
/// operator presses a button for it.
/// </summary>
[System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode",
    Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode",
    Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class NcRapidChange
{
    /// <summary>Device tag, accessory id and radio peer name.</summary>
    public const string Id = "ncrapidchange";

    public const int ServoMinUs = 500;
    public const int ServoMaxUs = 2500;
    public const int MoveMinMs = 100;
    public const int MoveMaxMs = 5000;
    public const int FilterMaxMs = 50;

    private const int ReadTimeoutMs = 900;
    // A change is written to flash on the device before it answers.
    private const int WriteTimeoutMs = 2500;
    private const string NoAnswer = "The RapidChangeATC Air did not answer. Check that it is on, and paired or cabled.";

    private static async Task<string> AskAsync(AccessoryService svc, string command, string prefix, int timeoutMs)
    {
        var reply = await svc.QueryPeerAsync(Id, command,
            l => l.StartsWith(prefix, StringComparison.Ordinal), timeoutMs).ConfigureAwait(false);
        // Name the command: an older firmware answers some and not others.
        return reply ?? throw new InvalidOperationException(
            $"The RapidChangeATC Air did not answer {prefix.TrimEnd(':')}. Check that it is on, and that its firmware is current.");
    }

    /// <summary>
    /// What the sensors and the cover read now. Asked with the two short
    /// commands, not $STATUS: that answer is too long for the board's USB
    /// buffer, arrives cut off, and takes the next answer with it.
    /// Null when the device does not answer.
    /// </summary>
    public static async Task<RapidChangeState?> ReadStateAsync(AccessoryService svc)
    {
        var frame = await svc.QueryPeerAsync(Id, "status",
            l => StateFrame(l) is not null, ReadTimeoutMs).ConfigureAwait(false);
        if (frame is null) return null;
        var cover = await svc.QueryPeerAsync(Id, "$COVER",
            l => l.StartsWith("$COVER:", StringComparison.Ordinal), ReadTimeoutMs).ConfigureAwait(false);
        return cover is null ? null : ParseState(StateFrame(frame)!, cover);
    }

    /// <summary>
    /// The answer to "status": the state frame "&lt;digit&gt;:S:&lt;seq&gt;:R" (tagged
    /// "@ncrapidchange " on the cable, bare over the radio) or "$SLEEP" in low
    /// power. Null for any other line.
    /// </summary>
    internal static string? StateFrame(string line)
    {
        const string tag = "@" + Id + " ";
        var payload = line.StartsWith(tag, StringComparison.OrdinalIgnoreCase) ? line[tag.Length..] : line;
        if (payload == "$SLEEP") return payload;
        return payload.Length > 3 && payload[0] is >= '0' and <= '3' && payload.AsSpan(1, 3).SequenceEqual(":S:")
            ? payload : null;
    }

    // frame: "2:S:41:R" (bit0 = tool setter, bit1 = IR beam) or "$SLEEP"; cover: "$COVER:1 open".
    internal static RapidChangeState ParseState(string frame, string cover)
    {
        var awake = frame != "$SLEEP";
        var bits = awake ? frame[0] - '0' : 0;
        return new RapidChangeState((bits & 1) != 0, (bits & 2) != 0,
                                    cover.EndsWith(" open", StringComparison.Ordinal), ParseHasCover(cover), awake);
    }

    public static async Task<RapidChangeSettings> ReadSettingsAsync(AccessoryService svc)
    {
        // One at a time: the radio carries one question and its answer.
        var cover = await AskAsync(svc, "$COVER", "$COVER:", ReadTimeoutMs).ConfigureAwait(false);
        var front = ParseServo(await AskAsync(svc, "$SERVO:F", "$SERVO:", ReadTimeoutMs).ConfigureAwait(false));
        var back = ParseServo(await AskAsync(svc, "$SERVO:B", "$SERVO:", ReadTimeoutMs).ConfigureAwait(false));
        var move = ParseInt(await AskAsync(svc, "$MOVE", "$MOVE:", ReadTimeoutMs).ConfigureAwait(false), "$MOVE:");
        var inv = ParseInvert(await AskAsync(svc, "$INV", "$INV:", ReadTimeoutMs).ConfigureAwait(false));
        var filter = ParseInt(await AskAsync(svc, "$FILTER", "$FILTER:", ReadTimeoutMs).ConfigureAwait(false), "$FILTER:");
        return new RapidChangeSettings(ParseHasCover(cover), front.Open, front.Close, back.Open, back.Close,
                                       move, inv.Tls, inv.Ir, filter);
    }

    // "$COVER:1 open" -> true.
    internal static bool ParseHasCover(string reply) =>
        reply.Length > "$COVER:".Length && reply["$COVER:".Length] == '1';

    // "$SERVO:F:2000:1000" -> (2000, 1000).
    internal static (int Open, int Close) ParseServo(string reply)
    {
        var parts = reply.Split(':');
        if (parts.Length == 4
            && int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var open)
            && int.TryParse(parts[3], NumberStyles.None, CultureInfo.InvariantCulture, out var close))
            return (open, close);
        throw new InvalidOperationException($"Unexpected answer from the RapidChangeATC Air: {reply}");
    }

    // "$INV:1:0" -> (true, false). 1 = that sensor pulls its line low when triggered.
    internal static (bool Tls, bool Ir) ParseInvert(string reply)
    {
        var parts = reply.Split(':');
        if (parts.Length == 3) return (parts[1].Trim() == "1", parts[2].Trim() == "1");
        throw new InvalidOperationException($"Unexpected answer from the RapidChangeATC Air: {reply}");
    }

    internal static int ParseInt(string reply, string prefix) =>
        int.TryParse(reply[prefix.Length..].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var v)
            ? v
            : throw new InvalidOperationException($"Unexpected answer from the RapidChangeATC Air: {reply}");

    /// <summary>
    /// What is wrong with a change, or null when it can be sent. Checked before
    /// anything goes to the device, so a bad value changes nothing.
    /// </summary>
    internal static string? Validate(RapidChangeSettingsRequest req)
    {
        static bool ServoOk(int? us) => us is null or (>= ServoMinUs and <= ServoMaxUs);
        if (!ServoOk(req.FrontOpenUs) || !ServoOk(req.FrontCloseUs) || !ServoOk(req.BackOpenUs) || !ServoOk(req.BackCloseUs))
            return $"A servo position must be {ServoMinUs} to {ServoMaxUs}";
        if ((req.FrontOpenUs is null) != (req.FrontCloseUs is null) || (req.BackOpenUs is null) != (req.BackCloseUs is null))
            return "A servo needs both its open and its closed position";
        if (req.MoveMs is < MoveMinMs or > MoveMaxMs) return $"Travel time must be {MoveMinMs} to {MoveMaxMs} ms";
        if (req.FilterMs is < 0 or > FilterMaxMs) return $"The filter must be 0 to {FilterMaxMs} ms";
        return null;
    }

    /// <summary>Apply the fields present, then read everything back.</summary>
    public static async Task<RapidChangeSettings> UpdateAsync(AccessoryService svc, RapidChangeSettingsRequest req)
    {
        if (Validate(req) is { } problem) throw new InvalidOperationException(problem);

        static string N(int v) => v.ToString(CultureInfo.InvariantCulture);

        if (req.HasCover is { } hasCover)
            await AskAsync(svc, $"$COVER:{(hasCover ? 1 : 0)}", "$COVER:", WriteTimeoutMs).ConfigureAwait(false);
        if (req.FrontOpenUs is { } fo && req.FrontCloseUs is { } fc)
            RequireServoOk(await AskAsync(svc, $"$SERVO:F:{N(fo)}:{N(fc)}", "$SERVO:", WriteTimeoutMs).ConfigureAwait(false));
        if (req.BackOpenUs is { } bo && req.BackCloseUs is { } bc)
            RequireServoOk(await AskAsync(svc, $"$SERVO:B:{N(bo)}:{N(bc)}", "$SERVO:", WriteTimeoutMs).ConfigureAwait(false));
        if (req.MoveMs is { } move)
            await AskAsync(svc, $"$MOVE:{N(move)}", "$MOVE:", WriteTimeoutMs).ConfigureAwait(false);
        if (req.InvertTls is not null || req.InvertIr is not null)
        {
            // The device takes both at once; keep the one that was not sent.
            var cur = ParseInvert(await AskAsync(svc, "$INV", "$INV:", ReadTimeoutMs).ConfigureAwait(false));
            var tls = req.InvertTls ?? cur.Tls;
            var ir = req.InvertIr ?? cur.Ir;
            await AskAsync(svc, $"$INV:{(tls ? 1 : 0)}:{(ir ? 1 : 0)}", "$INV:", WriteTimeoutMs).ConfigureAwait(false);
        }
        if (req.FilterMs is { } filter)
            await AskAsync(svc, $"$FILTER:{N(filter)}", "$FILTER:", WriteTimeoutMs).ConfigureAwait(false);

        return await ReadSettingsAsync(svc).ConfigureAwait(false);
    }

    private static void RequireServoOk(string reply)
    {
        if (reply.StartsWith("$SERVO:ERR", StringComparison.Ordinal))
            throw new InvalidOperationException($"The RapidChangeATC Air refused the servo setting: {reply["$SERVO:ERR".Length..].Trim()}");
    }

    /// <summary>Move one servo to a pulse width now. Refused by the device while it has no cover set.</summary>
    public static async Task ServoGoAsync(AccessoryService svc, string servo, int us)
    {
        var which = servo.Trim().ToUpperInvariant();
        if (which is not ("F" or "B")) throw new InvalidOperationException("Servo must be F (front) or B (back)");
        if (us is < ServoMinUs or > ServoMaxUs)
            throw new InvalidOperationException($"A servo position must be {ServoMinUs} to {ServoMaxUs}");
        var reply = await AskAsync(svc, $"$SERVO:{which}:GO:{us.ToString(CultureInfo.InvariantCulture)}",
            "$SERVO:", WriteTimeoutMs).ConfigureAwait(false);
        if (reply.StartsWith("$SERVO:ERR", StringComparison.Ordinal))
            throw new InvalidOperationException("Turn on \"Has a dust cover\" before moving a servo.");
    }

    /// <summary>Open or close the cover, to the saved positions.</summary>
    public static async Task MoveCoverAsync(AccessoryService svc, bool open)
    {
        var reply = await AskAsync(svc, open ? "cover:open" : "cover:close", "$COVER:", WriteTimeoutMs).ConfigureAwait(false);
        if (reply.StartsWith("$COVER:disabled", StringComparison.Ordinal))
            throw new InvalidOperationException("Turn on \"Has a dust cover\" before moving the cover.");
    }

    public static void Map(IEndpointRouteBuilder app)
    {
        const string root = "/api/accessories/" + Id;

        static IResult Unreachable(string message) =>
            Results.Json(new ApiError(message), NcSenderJsonContext.Default.ApiError, statusCode: 503);

        app.MapGet(root + "/state", async (AccessoryService svc) =>
        {
            var state = await ReadStateAsync(svc);
            return state is null ? Unreachable(NoAnswer) : Results.Ok(state);
        });

        app.MapGet(root + "/settings", async (AccessoryService svc) =>
        {
            try { return Results.Ok(await ReadSettingsAsync(svc)); }
            catch (InvalidOperationException ex) { return Unreachable(ex.Message); }
        });

        app.MapPost(root + "/settings", async (RapidChangeSettingsRequest req, AccessoryService svc) =>
        {
            try { return Results.Ok(await UpdateAsync(svc, req)); }
            catch (InvalidOperationException ex) { return Results.BadRequest(new ApiError(ex.Message)); }
        });

        app.MapPost(root + "/servo-go", async (RapidChangeServoGoRequest req, AccessoryService svc) =>
        {
            try { await ServoGoAsync(svc, req.Servo ?? "", req.Us); }
            catch (InvalidOperationException ex) { return Results.BadRequest(new ApiError(ex.Message)); }
            return Results.Ok();
        });

        app.MapPost(root + "/cover", async (RapidChangeCoverRequest req, AccessoryService svc) =>
        {
            try { await MoveCoverAsync(svc, req.Open); }
            catch (InvalidOperationException ex) { return Results.BadRequest(new ApiError(ex.Message)); }
            return Results.Ok();
        });
    }
}
