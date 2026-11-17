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
    /// <summary>The loaded program as the job sends it, with each line's estimated seconds; null when none is loaded.</summary>
    Task<LoadedProgram?> GetLoadedProgramAsync();
}

/// <param name="Content">The program text; job line N is <c>Content.Split('\n')[N - 1]</c>.</param>
/// <param name="LineSec">Estimated seconds per line, same indexing, 0 for lines without motion.</param>
/// <param name="Stamp">When the program file was written; changes when another program loads.</param>
public sealed record LoadedProgram(string Content, double[] LineSec, DateTime Stamp);
