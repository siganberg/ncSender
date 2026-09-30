using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.CommandProcessor;

/// <summary>
/// Sends what the command processor expanded one line into (a tool change,
/// $TLS, a macro...) and stops at the first line the controller rejects.
///
/// Jobs already stop on an error (GcodeJobProcessor). Commands from the UI,
/// the pendant and macros used to send every remaining line anyway: a typo
/// in a plugin's Pre Tool Change event (M960 PO) left the controller
/// rejecting line after line while the tool change reported itself done.
///
/// Lines marked <see cref="ProcessedCommand.Cleanup"/> (the tool change end
/// marker, the probe source restore) are still sent so the machine state
/// unwinds, and the user is told which line failed.
/// </summary>
public static class ExpandedCommandSender
{
    public static async Task<CommandResult?> SendAsync(
        ICncController controller,
        IBroadcaster broadcaster,
        ILogger logger,
        IReadOnlyList<ProcessedCommand> commands,
        Func<ProcessedCommand, CommandOptions> optionsFor)
    {
        CommandResult? last = null;
        for (var i = 0; i < commands.Count; i++)
        {
            var cmd = commands[i];
            last = await controller.SendCommandAsync(cmd.Command, optionsFor(cmd));
            if (last.Status != "error" || commands.Count == 1 || cmd.Cleanup) continue;

            var skipped = commands.Skip(i + 1).Where(c => !c.Cleanup).Count();
            if (skipped == 0) continue;

            logger.LogWarning(
                "Controller rejected {Command} ({Error}); {Skipped} remaining line(s) of the sequence not sent",
                cmd.Command, last.ErrorMessage, skipped);

            foreach (var cleanup in commands.Skip(i + 1).Where(c => c.Cleanup))
                await controller.SendCommandAsync(cleanup.Command, optionsFor(cleanup));

            var shown = System.Net.WebUtility.HtmlEncode(cmd.DisplayCommand ?? cmd.Command);
            var error = System.Net.WebUtility.HtmlEncode(last.ErrorMessage ?? "error");
            var html =
                "<div style=\"padding:20px;max-width:520px\">"
                + "<h3 style=\"margin:0 0 10px\">Sequence stopped</h3>"
                + "<p style=\"margin:0 0 10px\">The controller rejected this line, so the rest of the sequence was not sent:</p>"
                + $"<pre style=\"margin:0 0 10px;white-space:pre-wrap\">{shown}</pre>"
                + $"<p style=\"margin:0 0 10px;opacity:.8\">{error}</p>"
                + "<p style=\"margin:0\">Check the line (for example a Pre/Post event in the tool changer plugin), then try again.</p>"
                + "</div>";
            _ = broadcaster.Broadcast("plugin:show-modal",
                new WsShowModal("sequence-stopped", html, Closable: true),
                NcSenderJsonContext.Default.WsShowModal);
            break;
        }
        return last;
    }
}
