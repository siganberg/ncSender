namespace NcSender.Server.Connection;

/// <summary>
/// Lets a plugin prompt say what Abort does instead of a bare soft reset:
///
///     (GATE_ABORT_OFFERED)
///     (MSG, PLUGIN_X:SOMETHING_FAILED)
///     M0
///     (GATE_ABORT)
///       ...lines run only on Abort (e.g. leave the rack, return to origin)...
///     (GATE_END)
///     ...lines run on Continue...
///
/// Continue skips the block. Abort resumes the M0, sends only the block, then
/// the gate soft-resets as before, so the rest of the change (and a running
/// job) is still dropped. A prompt without the markers keeps the plain reset.
/// The markers are handled by ncSender and never reach the controller.
/// </summary>
internal static class GateAbortBlock
{
    public const string OfferedMarker = "(GATE_ABORT_OFFERED)";
    public const string StartMarker = "(GATE_ABORT)";
    public const string EndMarker = "(GATE_END)";

    public static bool IsOffered(string command) => Is(command, OfferedMarker);
    public static bool IsStart(string command) => Is(command, StartMarker);
    public static bool IsEnd(string command) => Is(command, EndMarker);

    private static bool Is(string command, string marker)
        => string.Equals(command.Trim(), marker, StringComparison.OrdinalIgnoreCase);
}
