namespace NcSender.Server.Tools;

/// <summary>
/// Settles Tool Numbering once at startup for installs that predate it
/// (<see cref="ToolService.DecideNumberingAsync"/>).
/// </summary>
public sealed class ToolLibraryDefault(ToolService tools, ILogger<ToolLibraryDefault> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try { await tools.DecideNumberingAsync(); }
        catch (Exception ex) { logger.LogWarning(ex, "Could not settle the Tool Numbering default"); }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
