using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Tools;

/// <summary>
/// After a tool change or tool length measurement is cut short, the loaded
/// tool's length can't be trusted: the sequence may already have cleared the
/// old offset (G43.1 Z0) without measuring the new one. ncSender kept treating
/// the tool as measured, so a Z0 set afterwards wasn't recognised as "set
/// without a reference", and the next tool change applied a full offset on
/// top of it: the new tool plunged.
///
/// Clearing the offset (G49) once the machine is Idle makes the controller
/// and ncSender agree that there is no reference. The TLS button then asks for
/// a measurement, job start measures the loaded tool, and a Z0 set in between
/// is kept by the next tool change.
/// </summary>
public sealed class ToolLengthOnAbort : IHostedService
{
    private readonly IToolChangeTracker _tracker;
    private readonly ICncController _controller;
    private readonly ILogger<ToolLengthOnAbort> _logger;
    private volatile bool _pending;
    private int _sending;

    public ToolLengthOnAbort(IToolChangeTracker tracker, ICncController controller, ILogger<ToolLengthOnAbort> logger)
    {
        _tracker = tracker;
        _controller = controller;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _tracker.Ended += OnEnded;
        _controller.StatusReportReceived += OnStatus;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _tracker.Ended -= OnEnded;
        _controller.StatusReportReceived -= OnStatus;
        return Task.CompletedTask;
    }

    private void OnEnded(ToolChangeEvent e)
    {
        if (e.Outcome != "aborted") return;
        _pending = true;
        _logger.LogInformation("{Kind} T{Tool} was interrupted ({Reason}): its tool length is cleared once the machine is idle",
            e.Info.Kind, e.Info.Tool, e.Reason);
    }

    // An alarm or a stop can leave the controller unable to take G-code for
    // a while; the first Idle report after that sends it.
    private void OnStatus(MachineState state)
    {
        if (!_pending || !string.Equals(state.Status, "Idle", StringComparison.OrdinalIgnoreCase)) return;
        if (Interlocked.Exchange(ref _sending, 1) == 1) return;
        _ = ClearAsync();
    }

    private async Task ClearAsync()
    {
        try
        {
            var result = await _controller.SendCommandAsync("G49", new CommandOptions
            {
                DisplayCommand = "G49 (tool change interrupted: tool length cleared)",
                Meta = new CommandMeta { SourceId = "system" },
            });
            if (result.Status == "success") _pending = false;
            else _logger.LogWarning("Clearing the tool length after an interrupted tool change failed: {Error}", result.ErrorMessage);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Clearing the tool length after an interrupted tool change failed");
        }
        finally
        {
            Interlocked.Exchange(ref _sending, 0);
        }
    }
}
