namespace NcSender.Server.Connection;

/// <summary>
/// Response timeout for manual commands (terminal/panel/jog/pendant). The
/// only thing this guards against is the queue stalling when the controller
/// silently drops or delays an "ok" — i.e. choking. Long-running ops like
/// homing, motion, spindle ramp, dwell are the controller's responsibility;
/// jobs and macros bypass the timeout entirely (see CncController).
/// </summary>
public static class CommandTimeoutPolicy
{
    public static readonly TimeSpan Default = TimeSpan.FromSeconds(1);

    public static TimeSpan? GetTimeout(string command) => Default;
}
