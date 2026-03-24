using System.Diagnostics;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Core.Utils;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Job;

internal class GcodeJobProcessor
{
    private readonly ICncController _controller;
    private readonly ICommandProcessor _commandProcessor;
    private readonly IServerContext _context;
    private readonly ILogger _logger;
    private readonly int _startLine;
    private readonly string[]? _resumeSequence;

    private volatile bool _isPaused;
    private volatile bool _isStopped;
    private readonly Stopwatch _stopwatch = new();

    public GcodeJobProcessor(
        ICncController controller,
        ICommandProcessor commandProcessor,
        IServerContext context,
        ILogger logger,
        int startLine = 1,
        string[]? resumeSequence = null)
    {
        _controller = controller;
        _commandProcessor = commandProcessor;
        _context = context;
        _logger = logger;
        _startLine = startLine;
        _resumeSequence = resumeSequence;
    }

    public void Pause() => _isPaused = true;
    public void Resume() => _isPaused = false;
    public void Stop() => _isStopped = true;

    public async Task ProcessLinesAsync()
    {
        var cachePath = Path.Combine(PathUtils.GetGcodeCacheDir(), "current.gcode");
        if (!File.Exists(cachePath))
        {
            _logger.LogError("No cached G-code file found at {Path}", cachePath);
            return;
        }

        var job = _context.State.JobLoaded;
        if (job is null) return;

        var totalLines = job.TotalLines;
        _stopwatch.Start();

        // Send resume preamble commands before processing the file
        // Route through command processor so M6 tool changes, plugin expansion,
        // safety checks, and IsToolChanging flow all work correctly
        if (_resumeSequence is { Length: > 0 })
        {
            _logger.LogInformation("Sending {Count} resume preamble commands", _resumeSequence.Length);
            foreach (var cmd in _resumeSequence)
            {
                if (_isStopped) break;

                var trimmed = cmd.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;

                // Wait while paused
                while (_isPaused && !_isStopped)
                {
                    await Task.Delay(100);
                }
                if (_isStopped) break;

                var processorContext = new CommandProcessorContext
                {
                    MachineState = _context.State.MachineState,
                    LineNumber = 0,
                    Filename = job.Filename,
                    Meta = new CommandMeta { SourceId = "resume" }
                };

                var result = await _commandProcessor.ProcessAsync(trimmed, processorContext);

                if (!result.ShouldContinue)
                    continue;

                foreach (var processedCmd in result.Commands)
                {
                    if (_isStopped) break;

                    var options = new CommandOptions
                    {
                        DisplayCommand = processedCmd.DisplayCommand ?? trimmed,
                        Meta = processedCmd.Meta ?? new CommandMeta { SourceId = "resume" }
                    };

                    await _controller.SendCommandAsync(processedCmd.Command, options);
                }
            }
        }

        var fileLineNumber = 0;

        using var reader = new StreamReader(cachePath);
        string? line;

        while ((line = await reader.ReadLineAsync()) is not null)
        {
            if (_isStopped) break;

            fileLineNumber++;

            // Skip lines before startLine (matching V1 behavior)
            if (fileLineNumber < _startLine)
            {
                continue;
            }

            // Wait while paused
            while (_isPaused && !_isStopped)
            {
                await Task.Delay(100);
            }

            if (_isStopped) break;

            // Skip blank lines
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed))
            {
                UpdateProgress(job, fileLineNumber, totalLines);
                continue;
            }

            // Strip existing N-numbers, prepend new one using original file line number
            var stripped = GcodePatterns.StripNNumber(trimmed);
            var numbered = $"N{fileLineNumber} {stripped}";

            // Detect M6 — set NextXYPosition to suppress return-to-position during job execution
            // (return-to-position is only for manual M6 invocations, not during program run)
            var m6Parse = GcodePatterns.ParseM6Command(stripped);
            XyPosition? nextXY = null;
            if (m6Parse.Matched && m6Parse.ToolNumber is not null)
                nextXY = new XyPosition { X = 0, Y = 0 };

            // Process through command processor
            var processorContext = new CommandProcessorContext
            {
                MachineState = _context.State.MachineState,
                LineNumber = fileLineNumber,
                Filename = job.Filename,
                NextXYPosition = nextXY
            };

            var result = await _commandProcessor.ProcessAsync(numbered, processorContext);

            if (!result.ShouldContinue)
            {
                UpdateProgress(job, fileLineNumber, totalLines);
                continue;
            }

            // Send each processed command
            foreach (var cmd in result.Commands)
            {
                if (_isStopped) break;

                // V1 parity: show original clean line (without N-prefix) for original commands,
                // use explicit displayCommand or cmd.command for plugin-expanded commands
                var displayCmd = cmd.DisplayCommand ?? (cmd.IsOriginal ? stripped : cmd.Command);

                var options = new CommandOptions
                {
                    DisplayCommand = displayCmd,
                    Meta = cmd.Meta ?? new CommandMeta { SourceId = "job" }
                };

                var cmdResult = await _controller.SendCommandAsync(cmd.Command, options);
                if (cmdResult.Status == "error")
                {
                    _logger.LogWarning("Command error at line {Line}: {Error}", fileLineNumber, cmdResult.ErrorMessage);
                    _isStopped = true;
                    break;
                }
            }

            UpdateProgress(job, fileLineNumber, totalLines);
        }

        _stopwatch.Stop();
    }

    private void UpdateProgress(JobInfo job, int sentLine, int totalLines)
    {
        // Use GRBL's Ln field (actual executing line) when available,
        // falling back to sent line number (matches V1 getExecutingLine behavior)
        var machineLn = _context.State.MachineState.Ln;
        var executingLine = (machineLn > 0 && machineLn <= sentLine) ? machineLn : sentLine;

        job.CurrentLine = executingLine;

        if (totalLines > 0)
            job.ProgressPercent = Math.Round((double)executingLine / totalLines * 100, 2);

        var elapsedSec = _stopwatch.Elapsed.TotalSeconds;
        var pausedSec = job.JobPausedTotalSec;
        job.RuntimeSec = Math.Round(elapsedSec - pausedSec, 2);
        job.ActualElapsedSec = Math.Round(elapsedSec, 2);

        if (executingLine > 0 && totalLines > executingLine)
        {
            var secPerLine = job.RuntimeSec / executingLine;
            job.RemainingSec = Math.Round(secPerLine * (totalLines - executingLine), 2);
        }

        // No explicit broadcast here — CncEventBridge broadcasts state delta on every
        // status report (~100ms), which picks up these job field changes automatically.
        // Broadcasting full state here would compete with the delta tracker and cause
        // the client to see ahead-of-execution currentLine values.
    }
}
