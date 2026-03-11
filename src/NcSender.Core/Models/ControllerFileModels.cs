namespace NcSender.Core.Models;

public class ControllerFileInfo
{
    public string Name { get; set; } = "";
    public long Size { get; set; }
}

public class ControllerFileListResponse
{
    public List<ControllerFileInfo> Files { get; set; } = [];
}

public class ControllerFileRunRequest
{
    public string Name { get; set; } = "";
}
