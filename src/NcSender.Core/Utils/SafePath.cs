namespace NcSender.Core.Utils;

public static class SafePath
{
    private static readonly char[] InvalidNameChars = ['/', '\\'];

    /// <summary>
    /// Resolves a relative path within a base directory, preventing directory traversal attacks.
    /// Returns the full resolved path if safe, or null if the path escapes the base directory.
    /// </summary>
    public static string? GetSafePath(string baseDir, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(baseDir) || string.IsNullOrWhiteSpace(relativePath))
            return null;

        // Reject explicit traversal patterns
        if (relativePath.Contains(".."))
            return null;

        var fullBase = Path.GetFullPath(baseDir);
        var resolved = Path.GetFullPath(Path.Combine(fullBase, relativePath));

        // Ensure resolved path stays within base directory
        if (!resolved.StartsWith(fullBase + Path.DirectorySeparatorChar) && resolved != fullBase)
            return null;

        return resolved;
    }

    /// <summary>
    /// Validates a filename or folder name, rejecting path separators and traversal sequences.
    /// </summary>
    public static bool IsValidName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return false;

        if (name.Contains(".."))
            return false;

        if (name.IndexOfAny(InvalidNameChars) >= 0)
            return false;

        return true;
    }
}
