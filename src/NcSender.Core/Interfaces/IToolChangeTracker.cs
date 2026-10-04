using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

/// <summary>
/// Follows each M6 / $TLS sequence from the moment the controller starts it
/// to the moment it finishes or is cut short, so plugins can tell a tool
/// change that ran to the end from one that was aborted. Every
/// <see cref="Started"/> is followed by exactly one <see cref="Ended"/>.
/// </summary>
public interface IToolChangeTracker
{
    /// <summary>
    /// Records a sequence about to be sent; the returned id goes into its
    /// TOOL_CHANGE_START / TOOL_CHANGE_COMPLETE sentinels.
    /// </summary>
    int Register(ToolChangeInfo info);

    event Action<ToolChangeEvent>? Started;
    event Action<ToolChangeEvent>? Ended;
}
