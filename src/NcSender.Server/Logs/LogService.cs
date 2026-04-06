using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;
using Serilog;

namespace NcSender.Server.Logs;

public class LogService : ILogService
{
    private const long MaxReadSize = 5 * 1024 * 1024; // 5MB

    private readonly ILogger<LogService> _logger;
    private readonly string _logsDir;

    public LogService(ILogger<LogService> logger)
    {
        _logger = logger;
        _logsDir = PathUtils.GetLogsDir();
    }

    public List<LogFileInfo> ListAsync()
    {
        var result = new List<LogFileInfo>();

        if (!Directory.Exists(_logsDir))
            return result;

        foreach (var file in Directory.GetFiles(_logsDir, "*.log")
                     .Select(f => new FileInfo(f))
                     .OrderByDescending(f => f.LastWriteTimeUtc))
        {
            result.Add(new LogFileInfo
            {
                Name = file.Name,
                Size = file.Length,
                Date = file.CreationTimeUtc,
                ModifiedAt = file.LastWriteTimeUtc
            });
        }

        return result;
    }

    public string? ReadAsync(string filename)
    {
        var path = GetFilePath(filename);
        if (path is null) return null;

        var info = new FileInfo(path);
        if (info.Length <= MaxReadSize)
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var sr = new StreamReader(fs);
            return sr.ReadToEnd();
        }

        // Tail the last 5MB
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        stream.Seek(-MaxReadSize, SeekOrigin.End);
        using var reader = new StreamReader(stream);
        // Skip partial first line
        reader.ReadLine();
        return reader.ReadToEnd();
    }

    public bool DeleteLog(string filename)
    {
        var path = GetFilePath(filename);
        if (path is null) return false;

        try
        {
            File.Delete(path);

            // Serilog's SharedFileSink caches file state and won't recover after
            // the active log file is deleted. Dispose and recreate the logger so
            // it opens a fresh file on the next write.
            var prev = Log.Logger;
            Log.Logger = RecreateLogger();
            (prev as IDisposable)?.Dispose();

            _logger.LogInformation("Log file cleared: {Filename}", filename);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete log file: {Filename}", filename);
            return false;
        }
    }

    private static Serilog.ILogger RecreateLogger()
    {
        var logsDir = PathUtils.GetLogsDir();
        const string outputTemplate = "[{Timestamp:yyyy-MM-ddTHH:mm:ss.fffZ}] [{Level:u4}] [{SourceContext}] {Message:lj}{NewLine}{Exception}";

        var logConfig = new LoggerConfiguration()
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.Hosting", Serilog.Events.LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.With(new ShortSourceContextEnricher());

        if (Environment.GetEnvironmentVariable("NCSENDER_PACKAGED") is null)
        {
            logConfig = logConfig.WriteTo.Console(
                outputTemplate: outputTemplate,
                theme: Serilog.Sinks.SystemConsole.Themes.AnsiConsoleTheme.Literate);
        }

        return logConfig
            .WriteTo.File(
                Path.Combine(logsDir, ".log"),
                outputTemplate: outputTemplate,
                rollingInterval: Serilog.RollingInterval.Day,
                retainedFileCountLimit: 30,
                shared: true)
            .CreateLogger();
    }

    public string? GetFilePath(string filename)
    {
        // Validate filename to prevent path traversal
        if (string.IsNullOrWhiteSpace(filename) ||
            filename.Contains("..") ||
            filename.Contains('/') ||
            filename.Contains('\\'))
        {
            return null;
        }

        var path = Path.Combine(_logsDir, filename);

        // Ensure path is within logs directory
        var fullPath = Path.GetFullPath(path);
        var fullLogsDir = Path.GetFullPath(_logsDir);
        if (!fullPath.StartsWith(fullLogsDir))
            return null;

        return File.Exists(fullPath) ? fullPath : null;
    }
}
