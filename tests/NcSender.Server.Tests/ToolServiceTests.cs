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
        UseLibrary(true);
    }

    private void UseLibrary(bool on) =>
        _settings.Setup(s => s.GetSetting<bool>(ToolService.UseLibrarySetting, true)).Returns(on);

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

    // --- Tool Library off: Slot N always loads Tool N ---------------------

    private async Task<ToolService> ServiceWithStoredToolAsync()
    {
        var svc = CreateService();
        await svc.AddAsync(new ToolInfo { Name = "Compression", ToolId = 300, ToolNumber = 1, Type = "flat", Diameter = 6.35 });
        return svc;
    }

    [Fact]
    public async Task Library_on_returns_the_stored_tools()
    {
        var svc = await ServiceWithStoredToolAsync();

        var tools = await svc.GetAllAsync();

        Assert.Single(tools);
        Assert.Equal(300, tools[0].ToolId);
    }

    [Fact]
    public async Task Library_off_puts_Tool_N_in_slot_N()
    {
        var svc = await ServiceWithStoredToolAsync();
        _settings.Setup(s => s.GetSetting<int>("tool.count", 0)).Returns(4);
        UseLibrary(false);

        var tools = await svc.GetAllAsync();

        Assert.Equal(new int?[] { 1, 2, 3, 4 }, tools.Select(t => t.ToolNumber));
        Assert.All(tools, t => Assert.Equal(t.ToolNumber, t.ToolId));   // T<n> is slot n
        Assert.All(tools, t => Assert.True(t.Id < 0));                  // never a stored tool
        Assert.DoesNotContain(tools, t => t.ToolId == 300);             // the user's library is not used
    }

    [Fact]
    public async Task Library_off_keeps_the_probe_slot()
    {
        var svc = CreateService();
        _settings.Setup(s => s.GetSetting<int>("tool.count", 0)).Returns(4);
        _settings.Setup(s => s.GetSetting<bool>("tool.probe", false)).Returns(true);
        _settings.Setup(s => s.GetSetting<int>("tool.probeToolNumber", 99)).Returns(99);
        UseLibrary(false);

        var tools = await svc.GetAllAsync();

        var probe = Assert.Single(tools, t => t.ToolNumber == 99);
        Assert.Equal(99, probe.ToolId);
        Assert.Equal("probe", probe.Type);
    }

    [Fact]
    public async Task Library_off_leaves_the_stored_library_untouched()
    {
        var svc = await ServiceWithStoredToolAsync();
        _settings.Setup(s => s.GetSetting<int>("tool.count", 0)).Returns(4);
        UseLibrary(false);

        // A built-in tool's measured length goes nowhere.
        var builtIn = (await svc.GetAllAsync()).First();
        builtIn.Offsets.Tlo = -42.5;
        Assert.Null(await svc.UpdateAsync(builtIn.Id, builtIn));

        // Saving what clients see while off would replace the user's tools.
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.BulkUpdateAsync(new List<ToolInfo> { builtIn }));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.AddAsync(new ToolInfo { Name = "X", ToolNumber = 2, Type = "flat", Diameter = 3 }));
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.DeleteAsync(1));

        UseLibrary(true);
        var stored = Assert.Single(await svc.GetAllAsync());
        Assert.Equal(300, stored.ToolId);
        Assert.Equal("Compression", stored.Name);
        Assert.Equal(0, stored.Offsets.Tlo);
    }

    [Fact]
    public async Task Library_off_tls_writeback_stores_nothing()
    {
        var svc = await ServiceWithStoredToolAsync();
        _settings.Setup(s => s.GetSetting<int>("tool.count", 0)).Returns(4);
        UseLibrary(false);
        var writeback = new PendingToolTloWriteback(svc, NullLogger<PendingToolTloWriteback>.Instance);

        writeback.Arm(1);
        writeback.Consume(-17.25);   // must not throw, must not write

        UseLibrary(true);
        Assert.Equal(0, Assert.Single(await svc.GetAllAsync()).Offsets.Tlo);
    }

    [Theory]
    [InlineData("useLibrary")]
    [InlineData("count")]
    [InlineData("probe")]
    public void Changing_a_library_setting_sends_clients_the_new_list(string key)
    {
        _ = CreateService();

        _settings.Raise(s => s.SettingsSaved += null,
            new System.Text.Json.Nodes.JsonObject { ["tool"] = new System.Text.Json.Nodes.JsonObject { [key] = 1 } });

        _broadcaster.Verify(b => b.Broadcast("tools-updated", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public void Unrelated_settings_do_not_resend_the_library()
    {
        _ = CreateService();

        _settings.Raise(s => s.SettingsSaved += null,
            new System.Text.Json.Nodes.JsonObject { ["tool"] = new System.Text.Json.Nodes.JsonObject { ["tls"] = true } });

        _broadcaster.Verify(b => b.Broadcast("tools-updated", It.IsAny<JsonElement>()), Times.Never);
    }
}
