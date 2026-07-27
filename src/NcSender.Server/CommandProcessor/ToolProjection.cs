using NcSender.Core.Interfaces;

namespace NcSender.Server.CommandProcessor;

/// <inheritdoc />
public sealed class ToolProjection : IToolProjection
{
    private readonly ILogger<ToolProjection> _logger;
    private readonly object _gate = new();

    // The tool the most recently queued M6 will leave in the spindle.
    // Null means nothing is outstanding and observed state is authoritative.
    private int? _pendingTool;

    // Queued-but-unfinished tool changes, counted via the TOOL_CHANGE_COMPLETE
    // sentinel. While this is non-zero the projection outranks observed state.
    private int _outstanding;

    public ToolProjection(ILogger<ToolProjection> logger)
    {
        _logger = logger;
    }

    public int EffectiveToolFor(int observedTool)
    {
        lock (_gate)
            return _pendingTool ?? observedTool;
    }

    public void ToolChangeQueued(int toolNumber)
    {
        lock (_gate)
        {
            _pendingTool = toolNumber;
            _outstanding++;
        }

        _logger.LogDebug("Tool projection: T{Tool} queued", toolNumber);
    }

    public void ToolChangeCompleted()
    {
        int remaining;
        lock (_gate)
        {
            if (_outstanding > 0) _outstanding--;
            remaining = _outstanding;
            if (remaining == 0) _pendingTool = null;
        }

        _logger.LogDebug("Tool projection: change completed, {Remaining} outstanding", remaining);
    }

    public void ActualToolObserved(int toolNumber)
    {
        lock (_gate)
        {
            // Safety net only. While changes are still queued the controller is
            // reporting a tool from earlier in the batch — and that value can
            // coincidentally equal the pending one (T1 → T0 → T1 reports T1
            // throughout), so clearing here would drop a live projection.
            if (_outstanding > 0) return;
            if (_pendingTool != toolNumber) return;
            _pendingTool = null;
        }

        _logger.LogDebug("Tool projection: controller caught up at T{Tool}", toolNumber);
    }

    public void Reset()
    {
        lock (_gate)
        {
            if (_pendingTool is null && _outstanding == 0) return;
            _pendingTool = null;
            _outstanding = 0;
        }

        _logger.LogDebug("Tool projection reset");
    }
}
