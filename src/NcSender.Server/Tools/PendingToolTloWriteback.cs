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
/// Armed entries have no expiry — if a probe is aborted before the reply
/// arrives, the arm sits until the next real probe consumes it. That's the
/// pragmatic tradeoff; a stale arm doesn't corrupt anything since the next
/// probe writes a fresh value.
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
    private readonly ConcurrentDictionary<int, byte> _pending = new();

    public PendingToolTloWriteback(IToolService toolService, ILogger<PendingToolTloWriteback> logger)
    {
        _toolService = toolService;
        _logger = logger;
    }

    public void Arm(int toolNumber)
    {
        if (toolNumber <= 0) return;
        _pending[toolNumber] = 1;
        _logger.LogInformation("Armed TLO writeback for T{Tool}", toolNumber);
    }

    public void Consume(double tloValue)
    {
        if (_pending.IsEmpty) return;
        var tools = _toolService.GetAllAsync().GetAwaiter().GetResult();
        foreach (var kv in _pending.ToArray())
        {
            var toolNumber = kv.Key;
            var tool = tools.FirstOrDefault(t => t.ToolNumber == toolNumber);
            if (tool is not null)
            {
                tool.Offsets.Tlo = tloValue;
                _toolService.UpdateAsync(tool.Id, tool).GetAwaiter().GetResult();
                _logger.LogInformation(
                    "Wrote back TLO={Tlo:F4} to T{Tool} (id={Id})",
                    tloValue, toolNumber, tool.Id);
            }
            _pending.TryRemove(toolNumber, out _);
        }
    }
}
