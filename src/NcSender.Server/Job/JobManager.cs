using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Job;

public class JobManager : IJobManager
{
    private readonly ICncController _controller;
    private readonly ICommandProcessor _commandProcessor;
    private readonly IServerContext _context;
    private readonly IBroadcaster _broadcaster;
    private readonly IJsPluginEngine _jsEngine;
    private readonly ILogger<JobManager> _logger;

    private GcodeJobProcessor? _activeProcessor;
    private Task? _activeTask;

    public bool HasActiveJob => _activeProcessor is not null;

    public JobManager(
        ICncController controller,
        ICommandProcessor commandProcessor,
        IServerContext context,
        IBroadcaster broadcaster,
        IJsPluginEngine jsEngine,
        ILogger<JobManager> logger)
    {
        _controller = controller;
        _commandProcessor = commandProcessor;
        _context = context;
        _broadcaster = broadcaster;
        _jsEngine = jsEngine;
        _logger = logger;
    }

    public Task StartJobFromLineAsync(int startLine, string[]? resumeSequence)
    {
        var job = _context.State.JobLoaded;
        if (job is null)
            throw new InvalidOperationException("No G-code file loaded");

        if (_activeProcessor is not null)
            throw new InvalidOperationException("A job is already running");

        // Don't modify the cached file — pass startLine and resumeSequence
        // to the processor which skips lines in-memory (matching V1 behavior)
        return StartJobInternalAsync(startLine, resumeSequence);
    }

    public Task StartJobAsync()
    {
        var job = _context.State.JobLoaded;
        if (job is null)
            throw new InvalidOperationException("No G-code file loaded");

        if (_activeProcessor is not null)
            throw new InvalidOperationException("A job is already running");

        return StartJobInternalAsync(startLine: 1, resumeSequence: null);
    }

    private Task StartJobInternalAsync(int startLine, string[]? resumeSequence)
    {
        var job = _context.State.JobLoaded!;

        // Initialize job state
        job.Status = "running";
        job.CurrentLine = startLine > 1 ? startLine : 0;
        job.ProgressPercent = 0;
        job.RuntimeSec = 0;
        job.RemainingSec = null;
        job.JobStartTime = DateTime.UtcNow;
        job.JobEndTime = null;
        job.JobPauseAt = null;
        job.JobPausedTotalSec = 0;
        job.ActualElapsedSec = 0;

        _activeProcessor = new GcodeJobProcessor(
            _controller,
            _commandProcessor,
            _context,
            _logger,
            startLine,
            resumeSequence);

        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);

        // Run job on background task
        _activeTask = Task.Run(async () =>
        {
            try
            {
                await _activeProcessor.ProcessLinesAsync();
                OnJobCompleted();
            }
            catch (OperationCanceledException)
            {
                // Expected when job is stopped — soft reset flushes the command queue,
                // cancelling the in-flight SendCommandAsync. Stop() already set status
                // to "stopped", so don't overwrite with "error".
                _logger.LogInformation("Job execution cancelled");
                _activeProcessor = null;
                _activeTask = null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Job execution failed");
                OnJobFailed(ex.Message);
            }
        });

        _logger.LogInformation("Job started: {Filename} ({TotalLines} lines, startLine={StartLine})",
            job.Filename, job.TotalLines, startLine);
        return Task.CompletedTask;
    }

    public void Pause()
    {
        if (_activeProcessor is null) return;

        var job = _context.State.JobLoaded;
        if (job is null) return;

        _activeProcessor.Pause();
        job.Status = "paused";
        job.JobPauseAt = DateTime.UtcNow;

        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogInformation("Job paused at line {Line}", job.CurrentLine);
    }

    public void Resume()
    {
        if (_activeProcessor is null) return;

        var job = _context.State.JobLoaded;
        if (job is null) return;

        // Accumulate paused time
        if (job.JobPauseAt.HasValue)
        {
            job.JobPausedTotalSec += (DateTime.UtcNow - job.JobPauseAt.Value).TotalSeconds;
            job.JobPauseAt = null;
        }

        _activeProcessor.Resume();
        job.Status = "running";

        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogInformation("Job resumed at line {Line}", job.CurrentLine);
    }

    public void Stop()
    {
        if (_activeProcessor is null) return;

        _activeProcessor.Stop();

        var job = _context.State.JobLoaded;
        if (job is not null)
        {
            job.Status = "stopped";
            job.JobEndTime = DateTime.UtcNow;

            if (job.JobPauseAt.HasValue)
            {
                job.JobPausedTotalSec += (DateTime.UtcNow - job.JobPauseAt.Value).TotalSeconds;
                job.JobPauseAt = null;
            }
        }

        _activeProcessor = null;
        _activeTask = null;

        NotifyPluginsJobEnded();
        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogInformation("Job stopped");
    }

    public void ForceReset()
    {
        if (_activeProcessor is null) return;

        _activeProcessor.Stop();

        var job = _context.State.JobLoaded;
        if (job is not null)
        {
            job.Status = "stopped";
            job.JobEndTime = DateTime.UtcNow;
        }

        _activeProcessor = null;
        _activeTask = null;

        NotifyPluginsJobEnded();
        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogInformation("Job force reset");
    }

    private void NotifyPluginsJobEnded()
    {
        foreach (var pluginId in _jsEngine.GetLoadedPluginIds())
            _jsEngine.ProcessOnAfterJobEnd(pluginId);
    }

    private void OnJobCompleted()
    {
        var job = _context.State.JobLoaded;
        if (job is not null && job.Status == "running")
        {
            job.Status = "completed";
            job.JobEndTime = DateTime.UtcNow;
            job.ProgressPercent = 100;
        }

        _activeProcessor = null;
        _activeTask = null;

        NotifyPluginsJobEnded();
        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogInformation("Job completed");
    }

    private void OnJobFailed(string error)
    {
        var job = _context.State.JobLoaded;
        if (job is not null)
        {
            job.Status = "error";
            job.JobEndTime = DateTime.UtcNow;
        }

        _activeProcessor = null;
        _activeTask = null;

        _context.UpdateSenderStatus();
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
        _logger.LogError("Job failed: {Error}", error);
    }
}
