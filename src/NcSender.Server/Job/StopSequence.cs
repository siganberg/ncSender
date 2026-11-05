using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Job;

/// <summary>
/// Stopping a job is Feed Hold, then Soft Reset. A reset that lands while the
/// axes are still decelerating raises "reset while in motion" and the machine
/// must be rehomed, so the reset waits until the controller reports that the
/// hold has finished (Hold:0) rather than for a fixed time. Machines with high
/// feeds or low acceleration can take well over a second to stop.
/// </summary>
public static class StopSequence
{
    public static readonly TimeSpan MaxWait = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollStep = TimeSpan.FromMilliseconds(20);

    // Status reports that must arrive after the feed hold before one is
    // trusted: the first may have been built before the controller read "!".
    private const int FreshReportsRequired = 2;

    // Without status feedback, never reset sooner than this after the hold.
    private const int MinNoStatusWaitMs = 1000;

    /// <summary>
    /// True when the state in a raw status report ("&lt;Hold:0|MPos:...&gt;")
    /// means the axes are not moving; false while moving or decelerating;
    /// null when the report can't be read.
    /// </summary>
    public static bool? IsMotionStopped(string? rawStatus)
    {
        if (string.IsNullOrWhiteSpace(rawStatus)) return null;

        var report = rawStatus.Trim().TrimStart('<');
        var end = report.IndexOfAny(['|', '>']);
        var state = (end >= 0 ? report[..end] : report).Trim();
        if (state.Length == 0) return null;

        var parts = state.Split(':');
        var name = parts[0].ToLowerInvariant();
        var sub = parts.Length > 1 ? parts[1] : null;

        return name switch
        {
            "run" or "jog" or "home" => false,
            // Hold:1 = decelerating, Hold:0 = hold complete. Plain "Hold" from
            // firmware without substates: treat as still stopping.
            "hold" => sub == "0",
            // Door:0 closed/ready and Door:1 stopped/ajar are at rest;
            // Door:2 is decelerating/parking and Door:3 is restoring.
            "door" => sub is "0" or "1",
            "idle" or "alarm" or "check" or "sleep" or "tool" => true,
            _ => null,
        };
    }

    /// <summary>
    /// Sends Feed Hold, waits for the machine to come to rest, then sends Soft
    /// Reset. <paramref name="fallbackDelayMs"/> is used when the controller's
    /// status can't be read.
    /// </summary>
    public static async Task FeedHoldThenResetAsync(
        ICncController cnc,
        int fallbackDelayMs,
        string sourceId,
        Func<Task>? afterStopped = null,
        CancellationToken ct = default)
    {
        await SendFeedHoldAsync(cnc, sourceId, ct);
        await WaitForMotionStopAsync(cnc, fallbackDelayMs, ct);
        if (afterStopped is not null) await afterStopped();
        await cnc.SendCommandAsync("\x18", new CommandOptions
        {
            DisplayCommand = "\\x18 (Soft Reset)",
            Meta = new CommandMeta { SourceId = sourceId, Silent = true }
        }, ct);
    }

    public static Task SendFeedHoldAsync(ICncController cnc, string sourceId, CancellationToken ct = default) =>
        cnc.SendCommandAsync("!", new CommandOptions
        {
            DisplayCommand = "! (Feed Hold)",
            Meta = new CommandMeta { SourceId = sourceId, Silent = true }
        }, ct);

    /// <summary>
    /// Call right after the feed hold was sent. Returns once two fresh status
    /// reports have arrived and the latest says the axes are at rest, after
    /// <see cref="MaxWait"/>, or after <paramref name="fallbackDelayMs"/>
    /// when no readable status reports arrive.
    /// </summary>
    public static async Task<StopWaitResult> WaitForMotionStopAsync(
        ICncController cnc,
        int fallbackDelayMs,
        CancellationToken ct = default)
    {
        var started = DateTime.UtcNow;
        var fallback = TimeSpan.FromMilliseconds(Math.Max(MinNoStatusWaitMs, fallbackDelayMs));
        var lastSeen = cnc.RawStatusData;
        var fresh = 0;
        var sawReadableState = false;

        while (true)
        {
            var elapsed = DateTime.UtcNow - started;
            var raw = cnc.RawStatusData;

            if (!ReferenceEquals(raw, lastSeen))
            {
                lastSeen = raw;
                fresh++;
            }

            if (fresh >= FreshReportsRequired)
            {
                var stopped = IsMotionStopped(raw);
                if (stopped is not null) sawReadableState = true;
                if (stopped == true) return StopWaitResult.Stopped;
            }

            if (!sawReadableState && elapsed >= fallback)
                return StopWaitResult.NoStatus;

            if (elapsed >= MaxWait) return StopWaitResult.TimedOut;

            await Task.Delay(PollStep, ct);
        }
    }
}

public enum StopWaitResult
{
    Stopped,
    NoStatus,
    TimedOut,
}
