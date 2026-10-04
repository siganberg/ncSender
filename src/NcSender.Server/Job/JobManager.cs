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
    private readonly ISettingsManager _settingsManager;
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
        ISettingsManager settingsManager,
        ILogger<JobManager> logger,
        IPluginManager? pluginManager = null)
    {
        _pluginManager = pluginManager;
        _controller = controller;
        _commandProcessor = commandProcessor;
        _context = context;
        _broadcaster = broadcaster;
        _jsEngine = jsEngine;
        _settingsManager = settingsManager;
        _logger = logger;
    }

    private readonly IPluginManager? _pluginManager;

    // An enabled plugin that shapes motion isn't running, or didn't prepare
    // the loaded program: refuse the job, with the reason in the terminal
    // (the start can come from the pendant, which shows no error).
    private void ThrowIfPluginsNotReady()
    {
        if (_pluginManager?.GetMotionBlocker() is not { } blocker) return;
        _logger.LogWarning("Job start refused: {Reason}", blocker);
        NcSender.Server.CommandProcessor.BlockedCommandNotice.Broadcast(_broadcaster, null, "Job start", blocker, "client");
        throw new InvalidOperationException(blocker);
    }

    public Task StartJobFromLineAsync(int startLine, string[]? resumeSequence)
    {
        var job = _context.State.JobLoaded;
        if (job is null)
            throw new InvalidOperationException("No G-code file loaded");

        if (_activeProcessor is not null)
            throw new InvalidOperationException("A job is already running");

        ThrowIfPluginsNotReady();

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

        ThrowIfPluginsNotReady();

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

        // Execute Program Start event (only for fresh start, not Start From Line)
        var isFromLine = startLine > 1 || resumeSequence is not null;

        // Run job on background task
        _activeTask = Task.Run(async () =>
        {
            try
            {
                var processor = _activeProcessor;
                await MeasureToolBeforeJobAsync(processor, startLine, resumeSequence);

                if (!isFromLine)
                    await ExecuteEventGcode("programStart");

                await processor.ProcessLinesAsync();
                if (processor.FailureReason is { } failureReason)
                    OnJobFailed(failureReason);
                else
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

    // A Z0 kept in the controller (G54 lives in its EEPROM) is only right with
    // the tool length offset it was set with, and that offset is gone after a
    // power cycle. Someone who zeroed once and just re-runs the job after a
    // reboot would cut the whole touch-off height off. So with a tool setter in
    // play (tool.tls, set by the tool changer plugin), a loaded tool and no
    // reference, measure it before the first line. The offsets are absolute, so
    // this restores the old Z0 exactly; a Z0 pending from this session is kept
    // by the plugin's own $TLS. Skipped when the program's first tool change
    // loads another tool: that change measures anyway.
    private async Task MeasureToolBeforeJobAsync(GcodeJobProcessor? processor, int startLine, string[]? resumeSequence)
    {
        var ms = _context.State.MachineState;
        if (processor is null || !LoadedToolMeasure.IsNeeded(ms, _settingsManager)) return;

        var cachePath = Path.Combine(PathUtils.GetGcodeCacheDir(), "current.gcode");
        var fileLines = File.Exists(cachePath)
            ? File.ReadLines(cachePath).Skip(Math.Max(0, startLine - 1))
            : Enumerable.Empty<string>();
        if (FirstToolChangeLoadsAnotherTool((resumeSequence ?? []).Concat(fileLines), ms.Tool))
        {
            _logger.LogInformation("No tool length reference, but the job's first tool change measures its tool");
            return;
        }

        var tool = ms.Tool;
        _logger.LogInformation("T{Tool} has no measured length: measuring it before the job", tool);
        SetMeasureBeforeJobTool(tool);
        try
        {
            await LoadedToolMeasure.SendTlsAsync(_commandProcessor, _controller, _context, "job-start",
                () => ReferenceEquals(_activeProcessor, processor));
        }
        finally
        {
            SetMeasureBeforeJobTool(0);
        }
    }

    private void SetMeasureBeforeJobTool(int tool)
    {
        _context.State.MachineState.MeasureBeforeJobTool = tool;
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
    }

    private static readonly System.Text.RegularExpressions.Regex CommentPattern =
        new(@"\([^)]*\)|;.*$", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex M6Pattern =
        new(@"(?<![A-Z\d.])M0*6(?![\d.])", System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    private static readonly System.Text.RegularExpressions.Regex TWordPattern =
        new(@"(?<![A-Z])T\s*0*(\d+)", System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    private static readonly System.Text.RegularExpressions.Regex MotionPattern =
        new(@"(?<![A-Z\d.])G0*[0-3](?![\d.])|^\s*(?:N\d+\s*)?[XYZABC]\s*[-+.\d]", System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    /// <summary>
    /// True when the program changes to a different tool before it moves at
    /// all — that tool change measures the new tool, so nothing needs doing
    /// first. Any motion before it runs with the loaded tool.
    /// </summary>
    internal static bool FirstToolChangeLoadsAnotherTool(IEnumerable<string> lines, int currentTool)
    {
        var lastT = 0;
        foreach (var raw in lines)
        {
            var line = CommentPattern.Replace(raw, "");
            if (string.IsNullOrWhiteSpace(line)) continue;
            var t = TWordPattern.Match(line);
            if (t.Success && int.TryParse(t.Groups[1].Value, out var tn)) lastT = tn;
            if (M6Pattern.IsMatch(line)) return lastT > 0 && lastT != currentTool;
            if (MotionPattern.IsMatch(line)) return false;
        }
        return false;
    }

    private async Task ExecuteEventGcode(string settingsKey)
    {
        var enabled = _settingsManager.GetSetting<bool?>($"events.{settingsKey}Enabled");
        if (enabled == false) return;

        var gcode = _settingsManager.GetSetting<string>($"events.{settingsKey}");
        if (string.IsNullOrWhiteSpace(gcode)) return;

        var lines = gcode.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var meta = new CommandOptions { Meta = new CommandMeta { SourceId = "event" } };

        _logger.LogInformation("Executing {Event} event G-code ({Lines} lines)", settingsKey, lines.Length);

        // Bracket the user's lines with comments so the terminal shows where
        // event G-code starts and stops. Anyone reading the log can then tell
        // these lines came from the Events tab, not the program file.
        var label = EventLabel(settingsKey);
        try
        {
            await _controller.SendCommandAsync($"({label} Event Begin)", meta);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Event G-code marker failed for {Event}", settingsKey);
            return;
        }

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
                continue;
            try
            {
                await _controller.SendCommandAsync(line, meta);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Event G-code line failed: {Line}", line);
                break;
            }
        }

        try
        {
            await _controller.SendCommandAsync($"({label} Event End)", meta);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Event G-code marker failed for {Event}", settingsKey);
        }
    }

    private static string EventLabel(string settingsKey) => settingsKey switch
    {
        "programStart" => "Program Start",
        "programEnd" => "Program End",
        _ => settingsKey
    };

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

        // Execute Program End event G-code
        _ = ExecuteEventGcode("programEnd");

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
