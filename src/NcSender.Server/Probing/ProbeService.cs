using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Probing;

public class ProbeService : IProbeService
{
    private readonly ICncController _controller;
    private readonly IServerContext _context;
    private readonly IBroadcaster _broadcaster;
    private readonly ILogger<ProbeService> _logger;

    public ProbeService(
        ICncController controller,
        IServerContext context,
        IBroadcaster broadcaster,
        ILogger<ProbeService> logger)
    {
        _controller = controller;
        _context = context;
        _broadcaster = broadcaster;
        _logger = logger;
    }

    public async Task StartAsync(Dictionary<string, JsonElement>? options, List<string>? commands)
    {
        if (!_controller.IsConnected)
            throw new InvalidOperationException("Controller not connected");

        // Generate commands from options if not provided
        if (commands is null or { Count: 0 })
        {
            var (generated, errors) = ProbeCommandGenerator.GenerateCommands(options);
            if (errors.Count > 0)
                throw new InvalidOperationException(string.Join("; ", errors));
            commands = generated;
        }

        _context.State.MachineState.IsProbing = true;
        _context.UpdateSenderStatus();
        await _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);

        _logger.LogInformation("Probe operation started");

        try
        {
            foreach (var cmd in commands)
            {
                var trimmed = cmd.Trim();
                if (string.IsNullOrWhiteSpace(trimmed)) continue;

                await _controller.SendCommandAsync(trimmed, new CommandOptions
                {
                    Meta = new CommandMeta { SourceId = "probe" }
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Probe operation failed");
            throw;
        }
        finally
        {
            _context.State.MachineState.IsProbing = false;
            _context.UpdateSenderStatus();
            await _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        }
    }

    public void Stop()
    {
        _context.State.MachineState.IsProbing = false;
        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogInformation("Probe operation stopped");

        if (_controller.IsConnected)
        {
            // Send soft reset to stop probe
            _ = _controller.SendCommandAsync("\x18", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "system", Silent = true }
            });
        }
    }
}
