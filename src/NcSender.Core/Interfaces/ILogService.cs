using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface ILogService
{
    List<LogFileInfo> ListAsync();
    string? ReadAsync(string filename);
    string? GetFilePath(string filename);
}
