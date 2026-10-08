namespace NcSender.Core.Models;

/// <summary>What a tool change is: an M6 (Kind "M6") or a tool length measurement (Kind "TLS").</summary>
public sealed record ToolChangeInfo(string Kind, int Tool, int PreviousTool, string Command, string? SourceId, bool JobRunning);

/// <summary>
/// A tool change starting or ending. On end, Outcome is "completed" or
/// "aborted"; an aborted change has a Reason: "error" (the controller
/// rejected a line), "alarm", "stopped" (stop / soft reset) or "disconnected".
/// LengthInDoubt: the last length line the controller accepted left the tool
/// length unknown: it cleared it (G43.1 Z0, G49), started measuring (a probe
/// move, $TLS) or handed over to a controller macro (bare M6, G65). A change
/// that never got that far, or whose last length line applied a real value
/// (G43.1 Z-48.695, G43.1 Z[#&lt;_NC_LAST_TLO&gt;] after a measurement), is not in doubt.
/// </summary>
public sealed record ToolChangeEvent(ToolChangeInfo Info, string? Outcome = null, string? Reason = null, bool LengthInDoubt = false);
