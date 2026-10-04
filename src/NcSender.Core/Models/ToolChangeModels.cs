namespace NcSender.Core.Models;

/// <summary>What a tool change is: an M6 (Kind "M6") or a tool length measurement (Kind "TLS").</summary>
public sealed record ToolChangeInfo(string Kind, int Tool, int PreviousTool, string Command, string? SourceId, bool JobRunning);

/// <summary>
/// A tool change starting or ending. On end, Outcome is "completed" or
/// "aborted"; an aborted change has a Reason: "error" (the controller
/// rejected a line), "alarm", "stopped" (stop / soft reset) or "disconnected".
/// </summary>
public sealed record ToolChangeEvent(ToolChangeInfo Info, string? Outcome = null, string? Reason = null);
