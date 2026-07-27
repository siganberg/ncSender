namespace NcSender.Core.Interfaces;

/// <summary>
/// Tracks which tool will be in the spindle once every already-expanded M6
/// has executed.
///
/// Command expansion runs ahead of execution: an M98 macro flattens its
/// whole body in one pass before the first line reaches the controller, and
/// the console dispatches pasted lines as fast as the WebSocket accepts
/// them (acceptance, not completion). In both cases MachineState.Tool is
/// still the tool from before the batch started, so every M6 in the batch
/// would otherwise be expanded against the same stale value — dropping
/// changes as "same tool" and building unload halves for tools that are no
/// longer in the spindle.
/// </summary>
public interface IToolProjection
{
    /// <summary>
    /// Tool to expand against: the pending change if one is outstanding,
    /// otherwise <paramref name="observedTool"/> (the caller's machine state).
    /// </summary>
    int EffectiveToolFor(int observedTool);

    /// <summary>A non-skipped M6 has been expanded and queued; it will leave <paramref name="toolNumber"/> loaded.</summary>
    void ToolChangeQueued(int toolNumber);

    /// <summary>A queued tool change finished (TOOL_CHANGE_COMPLETE sentinel came back).</summary>
    void ToolChangeCompleted();

    /// <summary>The controller reported the tool actually in the spindle.</summary>
    void ActualToolObserved(int toolNumber);

    /// <summary>Drop the projection — queued work will never execute (reset, stop, disconnect).</summary>
    void Reset();
}
