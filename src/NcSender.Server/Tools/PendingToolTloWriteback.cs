using System.Collections.Concurrent;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Tools;

/// <summary>
/// One-shot writeback of the next <c>[TLO:xxx]</c> response to a tool
/// library entry. Plugins arm it right before emitting a TLS probe routine
/// (via <c>pluginContext.armTlsWriteback(toolNumber)</c>); when the
/// controller replies with <c>[TLO:value]</c>, the listener writes that
/// value into the matching tool's <c>Offsets.Tlo</c> and clears the arm.
///
/// One probe measures one tool, so arming replaces any earlier arm, and an
/// arm expires after two minutes. Both matter: an arm left by a
/// probe that never finished (an alarm mid-TLS) used to stay pending and take
/// the NEXT measurement too, writing another tool's length into it.
/// </summary>
public interface IPendingToolTloWriteback
{
    void Arm(int toolNumber);
    void Consume(double tloValue);
}

public class PendingToolTloWriteback : IPendingToolTloWriteback
{
    private readonly IToolService _toolService;
    private readonly ILogger<PendingToolTloWriteback> _logger;
    // Tool number -> when it was armed.
    private readonly ConcurrentDictionary<int, DateTime> _pending = new();
    internal static readonly TimeSpan ArmLifetime = TimeSpan.FromMinutes(2);

    public PendingToolTloWriteback(IToolService toolService, ILogger<PendingToolTloWriteback> logger)
    {
        _toolService = toolService;
        _logger = logger;
    }

    public void Arm(int toolNumber)
    {
        if (toolNumber <= 0) return;
        // Latest arm wins: a stale one from an unfinished probe must not
        // receive this tool's measurement.
        _pending.Clear();
        _pending[toolNumber] = DateTime.UtcNow;
        _logger.LogInformation("Armed TLO writeback for T{Tool}", toolNumber);
    }

    public void Consume(double tloValue)
    {
        if (_pending.IsEmpty) return;
        var tools = _toolService.GetAllAsync().GetAwaiter().GetResult();
        foreach (var kv in _pending.ToArray())
        {
            var toolNumber = kv.Key;
            if (DateTime.UtcNow - kv.Value > ArmLifetime)
            {
                _pending.TryRemove(toolNumber, out _);
                _logger.LogInformation("Dropped expired TLO writeback arm for T{Tool}", toolNumber);
                continue;
            }
            // Tool ID first, then slot — as CncEventBridge resolves a T word
            // (tool-id concept: a T number names the tool, not the pocket).
            var tool = tools.FirstOrDefault(t => (t.ToolId ?? t.Id) == toolNumber)
                       ?? tools.FirstOrDefault(t => t.ToolNumber == toolNumber);
            if (tool is not null)
            {
                // Only the TLO is written: the tool as tool changes see it may carry
                // its slot as the Tool ID. Null for a plain slot tool (nothing stored).
                if (_toolService.UpdateOffsetsAsync(tool.Id, tlo: tloValue).GetAwaiter().GetResult() is not null)
                    _logger.LogInformation(
                        "Wrote back TLO={Tlo:F4} to T{Tool} (id={Id})",
                        tloValue, toolNumber, tool.Id);
            }
            _pending.TryRemove(toolNumber, out _);
        }
    }
}
