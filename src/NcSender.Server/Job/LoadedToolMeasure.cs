using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Job;

/// <summary>
/// Runs the tool changer's own $TLS on the loaded tool (plugin expansion
/// included, so a pending Z0 is kept the same way a button press keeps it).
/// Shared by the job-start measure and the measure after homing.
/// </summary>
internal static class LoadedToolMeasure
{
    /// <summary>
    /// Whether the loaded tool needs measuring: TLS is on (tool.tls), a tool
    /// changer plugin owns the tool settings (tool.source), a tool is loaded,
    /// nothing has measured it (no Tool Length Reference), and it is not laser
    /// mode. The plugin is required because $TLS is a plugin command: with TLS
    /// switched on by hand and no plugin, it would go to the controller, which
    /// does not know it (a controller-side TLS macro is a later addition).
    /// </summary>
    public static bool IsNeeded(MachineState ms, ISettingsManager settings) =>
        ms.Tool > 0 && !ms.ToolLengthSet
        && settings.GetSetting<bool>("tool.tls", false)
        && !string.IsNullOrWhiteSpace(settings.GetSetting<string>("tool.source"))
        && !settings.GetSetting<bool>("laserMode", false);

    public static async Task SendTlsAsync(ICommandProcessor processor, ICncController controller,
        IServerContext context, string sourceId, Func<bool> stillWanted)
    {
        var processorContext = new CommandProcessorContext
        {
            MachineState = context.State.MachineState,
            LineNumber = 0,
            Filename = context.State.JobLoaded?.Filename,
            Meta = new CommandMeta { SourceId = sourceId },
        };
        var result = await processor.ProcessAsync("$TLS", processorContext);
        if (!result.ShouldContinue) return;
        foreach (var cmd in result.Commands)
        {
            if (!stillWanted()) return;
            await controller.SendCommandAsync(cmd.Command, new CommandOptions
            {
                DisplayCommand = cmd.DisplayCommand ?? "$TLS",
                Meta = cmd.Meta ?? new CommandMeta { SourceId = sourceId }
            });
        }
    }
}
