using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IControllerFileService
{
    Task<List<ControllerFileInfo>> ListFilesAsync();
    Task RunFileAsync(string name);
    Task DeleteFileAsync(string name);
    Task<string> ReadFileAsync(string name);
    Task UploadFileAsync(string name, byte[] content, Action<double>? onProgress = null);
    Task SaveFileAsync(string name, string content, Action<double>? onProgress = null);
}
