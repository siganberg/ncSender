using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Tools;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

public class ToolServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly Mock<IBroadcaster> _broadcaster;
    private readonly Mock<ISettingsManager> _settings;

    public ToolServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"ncsender-tools-test-{Guid.NewGuid()}");
        Directory.CreateDirectory(_tempDir);

        _broadcaster = new Mock<IBroadcaster>();
        _broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        _settings = new Mock<ISettingsManager>();
        _settings.Setup(s => s.GetSetting<int>("tool.count", 0)).Returns(0);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    private ToolService CreateService()
    {
        var filePath = Path.Combine(_tempDir, "tools.json");
        return new ToolService(
            _broadcaster.Object,
            _settings.Object,
            NullLogger<ToolService>.Instance,
            filePath);
    }

    [Fact]
    public async Task AddTool_ValidTool_Succeeds()
    {
        var svc = CreateService();
        var tool = new ToolInfo { Name = "End Mill", ToolNumber = 1, Type = "flat", Diameter = 6.35 };

        var result = await svc.AddAsync(tool);

        Assert.NotNull(result);
        Assert.Equal("End Mill", result.Name);
        Assert.True(result.Id > 0);
    }

    [Fact]
    public async Task AddTool_MissingName_Throws()
    {
        var svc = CreateService();
        var tool = new ToolInfo { Name = "", ToolNumber = 1, Type = "flat", Diameter = 6.35 };

        await Assert.ThrowsAsync<ArgumentException>(() => svc.AddAsync(tool));
    }

    [Fact]
    public async Task AddTool_InvalidDiameter_Throws()
    {
        var svc = CreateService();
        var tool = new ToolInfo { Name = "Test", ToolNumber = 1, Type = "flat", Diameter = 0 };

        await Assert.ThrowsAsync<ArgumentException>(() => svc.AddAsync(tool));
    }

    [Fact]
    public async Task AddTool_InvalidType_Throws()
    {
        var svc = CreateService();
        var tool = new ToolInfo { Name = "Test", ToolNumber = 1, Type = "laser", Diameter = 6.35 };

        await Assert.ThrowsAsync<ArgumentException>(() => svc.AddAsync(tool));
    }

    [Fact]
    public async Task AddTool_BroadcastsUpdate()
    {
        var svc = CreateService();
        var tool = new ToolInfo { Name = "Test", ToolNumber = 1, Type = "flat", Diameter = 6.35 };

        await svc.AddAsync(tool);

        _broadcaster.Verify(b => b.Broadcast("tools-updated", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public async Task DeleteTool_NonExistent_ReturnsFalse()
    {
        var svc = CreateService();

        var result = await svc.DeleteAsync(999);

        Assert.False(result);
    }

    [Fact]
    public async Task BulkUpdate_ValidTools_Succeeds()
    {
        var svc = CreateService();
        var tools = new List<ToolInfo>
        {
            new() { Name = "Tool 1", ToolNumber = 1, Type = "flat", Diameter = 3.175 },
            new() { Name = "Tool 2", ToolNumber = 2, Type = "ball", Diameter = 6.35 }
        };

        await svc.BulkUpdateAsync(tools);

        var all = await svc.GetAllAsync();
        Assert.Equal(2, all.Count);
    }
}
