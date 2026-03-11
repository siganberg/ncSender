namespace NcSender.Core.Models;

public class GcodeFileTree
{
    public List<GcodeFileEntry> Tree { get; set; } = [];
    public string StoragePath { get; set; } = "";
}

public class GcodeFileEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "file"; // "file" or "folder"
    public string Path { get; set; } = "";
    public long? Size { get; set; }
    public DateTime? UploadedAt { get; set; }
    public List<GcodeFileEntry>? Children { get; set; }

    /// <summary>
    /// Generate a stable hash ID from a path (matches V1 generatePathId).
    /// </summary>
    public static string GeneratePathId(string itemPath)
    {
        var str = string.IsNullOrEmpty(itemPath) ? "root" : itemPath;
        var hash = 0;
        foreach (var c in str)
        {
            hash = ((hash << 5) - hash) + c;
            hash &= hash; // Convert to 32-bit int
        }
        return ToBase36(Math.Abs(hash));
    }

    private static string ToBase36(int value)
    {
        const string chars = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value == 0) return "0";
        var result = new char[13];
        var i = result.Length;
        while (value > 0)
        {
            result[--i] = chars[value % 36];
            value /= 36;
        }
        return new string(result, i, result.Length - i);
    }
}
