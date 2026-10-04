using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.CommandProcessor;

/// <summary>Shows a refused command in the terminal as "COMMAND (BLOCKED - reason)".</summary>
public static class BlockedCommandNotice
{
    public static void Broadcast(IBroadcaster broadcaster, string? commandId, string command, string reason, string? sourceId)
    {
        var id = string.IsNullOrEmpty(commandId) ? Guid.NewGuid().ToString() : commandId;
        var upper = command.Trim().ToUpperInvariant();
        var display = $"{command.Trim()} (BLOCKED - {reason})";
        var nowIso = DateTime.UtcNow.ToString("o");
        var source = sourceId ?? "client";
        _ = broadcaster.Broadcast("cnc-command",
            new WsCncCommandStatus(id, upper, display, "pending", nowIso, source),
            NcSenderJsonContext.Default.WsCncCommandStatus);
        _ = broadcaster.Broadcast("cnc-command-result",
            new WsCncCommandStatus(id, upper, display, "blocked", nowIso, source),
            NcSenderJsonContext.Default.WsCncCommandStatus);
    }
}
