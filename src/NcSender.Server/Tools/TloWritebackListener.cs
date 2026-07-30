using System.Globalization;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Tools;

/// <summary>
/// Subscribes to the controller's data stream and forwards <c>[TLO:xxx]</c>
/// responses to <see cref="IPendingToolTloWriteback"/>. Registered as a
/// hosted service so it stays alive for the lifetime of the app.
/// </summary>
public class TloWritebackListener : IHostedService
{
    private readonly ICncController _controller;
    private readonly IPendingToolTloWriteback _writeback;
    private readonly ILogger<TloWritebackListener> _logger;

    public TloWritebackListener(
        ICncController controller,
        IPendingToolTloWriteback writeback,
        ILogger<TloWritebackListener> logger)
    {
        _controller = controller;
        _writeback = writeback;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _controller.DataReceived += OnData;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _controller.DataReceived -= OnData;
        return Task.CompletedTask;
    }

    private void OnData(string data, string? sourceId)
    {
        if (data is null) return;
        var trimmed = data.Trim();
        if (!trimmed.StartsWith("[TLO:", StringComparison.Ordinal)) return;
        if (trimmed.Length < 6 || trimmed[^1] != ']') return;

        // grblHAL emits `[TLO:X,Y,Z,A]` after `$#`. Z (index 2) is the tool
        // length offset. Older builds sometimes emit a single value
        // (`[TLO:Z]`) — handle that too.
        var payload = trimmed[5..^1];
        double tloZ;
        if (payload.Contains(','))
        {
            var parts = payload.Split(',');
            if (parts.Length < 3) return;
            if (!double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out tloZ))
                return;
        }
        else
        {
            if (!double.TryParse(payload, NumberStyles.Float, CultureInfo.InvariantCulture, out tloZ))
                return;
        }

        try
        {
            _writeback.Consume(tloZ);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "TLO writeback consume failed for value {Tlo}", tloZ);
        }
    }
}
