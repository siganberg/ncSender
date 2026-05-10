using System.Text;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting;

namespace NcSender.Server.Logs;

/// <summary>
/// Daily-rolling file sink that survives external deletion of the active log
/// file. Inspired by serilog/serilog-sinks-file PR #365 — opens the file with
/// FileShare.ReadWrite | FileShare.Delete so the OS allows it to be removed
/// while we still hold the handle, and re-checks <see cref="File.Exists"/>
/// before every emit. If the active file is missing we drop the stale handle
/// and open a fresh one at the same path.
///
/// We don't use Serilog.Sinks.File's built-in rolling because its inner sink
/// can't be replaced; rolling and retention are simple enough to do inline.
/// </summary>
public sealed class ResilientRollingFileSink : ILogEventSink, IDisposable
{
    private readonly string _baseDir;
    private readonly string _baseExtension;
    private readonly ITextFormatter _formatter;
    private readonly int _retainedFileCountLimit;
    private readonly object _syncRoot = new();

    private FileStream? _stream;
    private StreamWriter? _writer;
    private string? _currentPath;

    public ResilientRollingFileSink(string basePath, ITextFormatter formatter, int retainedFileCountLimit)
    {
        ArgumentNullException.ThrowIfNull(basePath);
        ArgumentNullException.ThrowIfNull(formatter);

        _baseDir = Path.GetDirectoryName(basePath) ?? ".";
        _baseExtension = Path.GetExtension(basePath);
        if (string.IsNullOrEmpty(_baseExtension)) _baseExtension = ".log";
        _formatter = formatter;
        _retainedFileCountLimit = retainedFileCountLimit;
    }

    public void Emit(LogEvent logEvent)
    {
        lock (_syncRoot)
        {
            var todayPath = GetTodayPath();
            // Reopen if: first emit, day rolled, or active file was deleted
            // out from under us (the FileShare.Delete flag lets it happen).
            if (_writer is null || _currentPath != todayPath || !File.Exists(todayPath))
            {
                OpenStream(todayPath);
            }

            _formatter.Format(logEvent, _writer!);
            _writer!.Flush();
        }
    }

    private void OpenStream(string path)
    {
        _writer?.Dispose();
        _stream?.Dispose();

        Directory.CreateDirectory(_baseDir);

        _stream = new FileStream(
            path,
            FileMode.Append,
            FileAccess.Write,
            FileShare.ReadWrite | FileShare.Delete);
        _writer = new StreamWriter(_stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        _currentPath = path;

        ApplyRetention();
    }

    private string GetTodayPath()
    {
        return Path.Combine(_baseDir, $"{DateTime.UtcNow:yyyyMMdd}{_baseExtension}");
    }

    private void ApplyRetention()
    {
        if (_retainedFileCountLimit <= 0) return;

        try
        {
            var keep = Directory.GetFiles(_baseDir, $"*{_baseExtension}")
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .Skip(_retainedFileCountLimit);

            foreach (var f in keep)
            {
                try { f.Delete(); } catch { /* best effort */ }
            }
        }
        catch { /* best effort */ }
    }

    public void Dispose()
    {
        lock (_syncRoot)
        {
            _writer?.Dispose();
            _stream?.Dispose();
            _writer = null;
            _stream = null;
        }
    }
}
