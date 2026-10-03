namespace NcSender.Server.Tools;

/// <summary>
/// Settles "Use Tool Library" once at startup for installs that predate it
/// (<see cref="ToolService.DecideUseLibraryAsync"/>).
/// </summary>
public sealed class ToolLibraryDefault(ToolService tools, ILogger<ToolLibraryDefault> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try { await tools.DecideUseLibraryAsync(); }
        catch (Exception ex) { logger.LogWarning(ex, "Could not settle the Use Tool Library default"); }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
