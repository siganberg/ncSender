namespace NcSender.Core.Models;

public class LogFileInfo
{
    public string Name { get; set; } = "";
    public long Size { get; set; }
    public DateTime Date { get; set; }
    public DateTime ModifiedAt { get; set; }
}
