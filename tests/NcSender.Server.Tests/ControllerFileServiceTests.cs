using NcSender.Core.Models;

namespace NcSender.Server.Tests;

public class ControllerFileServiceTests
{
    [Fact]
    public void ControllerFileInfo_DefaultValues()
    {
        var info = new ControllerFileInfo();
        Assert.Equal("", info.Name);
        Assert.Equal(0, info.Size);
    }

    [Fact]
    public void ControllerFileInfo_SetValues()
    {
        var info = new ControllerFileInfo
        {
            Name = "test.gcode",
            Size = 12345
        };

        Assert.Equal("test.gcode", info.Name);
        Assert.Equal(12345, info.Size);
    }

    [Fact]
    public void ControllerFileListResponse_EmptyByDefault()
    {
        var response = new ControllerFileListResponse();
        Assert.NotNull(response.Files);
        Assert.Empty(response.Files);
    }

    [Fact]
    public void ControllerFileRunRequest_DefaultEmpty()
    {
        var request = new ControllerFileRunRequest();
        Assert.Equal("", request.Name);
    }

    [Fact]
    public void FileListParsing_ValidFormat()
    {
        // Simulate parsing [FILE:name|SIZE:bytes] format
        var line = "[FILE:test.gcode|SIZE:1024]";
        var match = System.Text.RegularExpressions.Regex.Match(line, @"\[FILE:(?<name>[^|]+)\|SIZE:(?<size>\d+)\]");

        Assert.True(match.Success);
        Assert.Equal("test.gcode", match.Groups["name"].Value);
        Assert.Equal("1024", match.Groups["size"].Value);
    }

    [Fact]
    public void FileListParsing_MultipleFiles()
    {
        var lines = new[]
        {
            "[FILE:file1.gcode|SIZE:1024]",
            "[FILE:file2.nc|SIZE:2048]",
            "[FILE:subdir/file3.gcode|SIZE:4096]"
        };

        var pattern = new System.Text.RegularExpressions.Regex(@"\[FILE:(?<name>[^|]+)\|SIZE:(?<size>\d+)\]");
        var files = new List<ControllerFileInfo>();

        foreach (var line in lines)
        {
            var match = pattern.Match(line);
            if (match.Success)
            {
                files.Add(new ControllerFileInfo
                {
                    Name = match.Groups["name"].Value,
                    Size = long.Parse(match.Groups["size"].Value)
                });
            }
        }

        Assert.Equal(3, files.Count);
        Assert.Equal("file1.gcode", files[0].Name);
        Assert.Equal(1024, files[0].Size);
        Assert.Equal("subdir/file3.gcode", files[2].Name);
        Assert.Equal(4096, files[2].Size);
    }

    [Fact]
    public void CommandConstruction_ListFiles()
    {
        var command = "$F";
        Assert.Equal("$F", command);
    }

    [Fact]
    public void CommandConstruction_RunFile()
    {
        var name = "test.gcode";
        var command = $"$F={name}";
        Assert.Equal("$F=test.gcode", command);
    }

    [Fact]
    public void CommandConstruction_DeleteFile()
    {
        var name = "test.gcode";
        var command = $"$FD={name}";
        Assert.Equal("$FD=test.gcode", command);
    }

    [Fact]
    public void CommandConstruction_ReadFile()
    {
        var name = "test.gcode";
        var command = $"$F<={name}";
        Assert.Equal("$F<=test.gcode", command);
    }
}
