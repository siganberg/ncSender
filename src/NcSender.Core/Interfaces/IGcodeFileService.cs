using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IGcodeFileService
{
    Task<GcodeFileTree> ListFilesAsync();
    Task UploadFileAsync(string filename, Stream content);
    Task LoadFileAsync(string path, bool applyPluginTransforms = true);
    Task LoadTempContentAsync(string content, string filename, string? sourceFile = null);
    Task<Stream?> GetCurrentDownloadStreamAsync();
    Task<string?> GetFileAsync(string path);
    Task SaveFileAsync(string path, string content);
    Task DeleteFileAsync(string path);
    Task CreateFolderAsync(string path);
    Task DeleteFolderAsync(string path);
    Task MoveAsync(string source, string destination);
    Task RenameAsync(string path, string newName);
    Task ClearLoadedAsync();
}
