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
        Numbering(ToolNumbering.ToolId);
    }

    private void Numbering(string value) =>
        _settings.Setup(s => s.GetSetting<string>(ToolNumbering.Setting, ToolNumbering.Slot)).Returns(value);

    private void Magazine(int size) =>
        _settings.Setup(s => s.GetSetting<int>("tool.count", 0)).Returns(size);

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

    // --- Tool Numbering --------------------------------------------------

    private async Task<ToolService> ServiceWithLibraryAsync()
    {
        var svc = CreateService();
        Magazine(0);   // assigning slots needs no magazine size check here
        await svc.AddAsync(new ToolInfo { Name = "Compression", ToolId = 300, ToolNumber = 2, Type = "flat", Diameter = 6.35 });
        await svc.AddAsync(new ToolInfo { Name = "3D probe", ToolId = 50, ToolNumber = null, Type = "probe", Diameter = 2 });
        return svc;
    }

    [Fact]
    public async Task Tool_ID_numbering_uses_the_stored_library()
    {
        var svc = await ServiceWithLibraryAsync();

        var tools = await svc.GetAllAsync();

        Assert.Equal(new int?[] { 300, 50 }, tools.Select(t => t.ToolId));
    }

    [Fact]
    public async Task Slot_numbering_T_n_is_slot_n_with_the_slotted_tool_kept()
    {
        var svc = await ServiceWithLibraryAsync();
        Magazine(4);
        Numbering(ToolNumbering.Slot);

        var tools = await svc.GetAllAsync();

        Assert.Equal(new int?[] { 1, 2, 3, 4 }, tools.Select(t => t.ToolNumber));
        Assert.All(tools, t => Assert.Equal(t.ToolNumber, t.ToolId));          // T<n> is slot n
        var slot2 = tools.Single(t => t.ToolNumber == 2);
        Assert.Equal("Compression", slot2.Name);                               // the library's tool, kept
        Assert.True(slot2.Id > 0);
        Assert.All(tools.Where(t => t.ToolNumber != 2), t => Assert.True(t.Id < 0));   // plain Tool n
        Assert.DoesNotContain(tools, t => t.Name == "3D probe");               // no slot: not reachable
    }

    [Fact]
    public async Task Slot_numbering_never_renumbers_the_stored_tools()
    {
        var svc = await ServiceWithLibraryAsync();
        Magazine(4);
        Numbering(ToolNumbering.Slot);

        _ = await svc.GetAllAsync();
        var stored = await svc.GetLibraryAsync();

        Assert.Equal(300, stored.Single(t => t.Name == "Compression").ToolId);
    }

    [Fact]
    public async Task Slot_numbering_tls_writeback_lands_on_the_slotted_tool_and_keeps_its_ID()
    {
        var svc = await ServiceWithLibraryAsync();
        Magazine(4);
        Numbering(ToolNumbering.Slot);
        var writeback = new PendingToolTloWriteback(svc, NullLogger<PendingToolTloWriteback>.Instance);

        writeback.Arm(2);            // M6 T2 = slot 2 = the Compression bit
        writeback.Consume(-17.25);

        var tool = (await svc.GetLibraryAsync()).Single(t => t.Name == "Compression");
        Assert.Equal(-17.25, tool.Offsets.Tlo);
        Assert.Equal(300, tool.ToolId);
    }

    [Fact]
    public async Task Slot_numbering_a_plain_slot_stores_nothing()
    {
        var svc = await ServiceWithLibraryAsync();
        Magazine(4);
        Numbering(ToolNumbering.Slot);
        var writeback = new PendingToolTloWriteback(svc, NullLogger<PendingToolTloWriteback>.Instance);

        writeback.Arm(3);
        writeback.Consume(-9);

        Assert.All(await svc.GetLibraryAsync(), t => Assert.Equal(0, t.Offsets.Tlo));
    }

    [Fact]
    public async Task Slot_numbering_keeps_the_probe_slot()
    {
        var svc = CreateService();
        Magazine(4);
        _settings.Setup(s => s.GetSetting<bool>("tool.probe", false)).Returns(true);
        _settings.Setup(s => s.GetSetting<int>("tool.probeToolNumber", 99)).Returns(99);
        Numbering(ToolNumbering.Slot);

        var probe = Assert.Single(await svc.GetAllAsync(), t => t.ToolNumber == 99);

        Assert.Equal(99, probe.ToolId);
        Assert.Equal("probe", probe.Type);
    }

    [Fact]
    public async Task The_Tool_Library_stays_editable_with_Slot_numbering()
    {
        var svc = await ServiceWithLibraryAsync();
        Numbering(ToolNumbering.Slot);

        await svc.AddAsync(new ToolInfo { Name = "Vee", ToolId = 12, Type = "v-bit", Diameter = 6 });

        Assert.Equal(3, (await svc.GetLibraryAsync()).Count);
    }

    [Fact]
    public async Task Slot_numbering_ignores_a_tool_assigned_past_the_magazine()
    {
        var svc = CreateService();
        await svc.AddAsync(new ToolInfo { Name = "Far", ToolId = 40, ToolNumber = 9, Type = "flat", Diameter = 3 });
        Magazine(4);
        Numbering(ToolNumbering.Slot);

        var tools = await svc.GetAllAsync();

        Assert.Equal(4, tools.Count);
        Assert.DoesNotContain(tools, t => t.Name == "Far");
    }

    [Fact]
    public async Task Slot_numbering_with_no_magazine_has_no_tools()
    {
        var svc = await ServiceWithLibraryAsync();
        Magazine(0);   // e.g. the Manual Tool Changer without a Solo
        Numbering(ToolNumbering.Slot);

        Assert.Empty(await svc.GetAllAsync());
    }

    // --- Offsets-only writes ---------------------------------------------

    [Fact]
    public async Task UpdateOffsets_writes_only_the_given_offsets()
    {
        var svc = await ServiceWithLibraryAsync();
        var id = (await svc.GetLibraryAsync()).Single(t => t.Name == "Compression").Id;
        await svc.UpdateOffsetsAsync(id, x: 1.5, y: -2);

        var updated = await svc.UpdateOffsetsAsync(id, tlo: -30.25);

        Assert.NotNull(updated);
        var tool = (await svc.GetLibraryAsync()).Single(t => t.Id == id);
        Assert.Equal(-30.25, tool.Offsets.Tlo);
        Assert.Equal(1.5, tool.Offsets.X);      // earlier values kept
        Assert.Equal(-2, tool.Offsets.Y);
        Assert.Equal(300, tool.ToolId);         // identity untouched
        Assert.Equal(2, tool.ToolNumber);
        Assert.Equal("Compression", tool.Name);
    }

    [Theory]
    [InlineData(-3)]     // a plain slot tool
    [InlineData(0)]
    [InlineData(9999)]   // unknown
    public async Task UpdateOffsets_stores_nothing_for_a_tool_that_isnt_stored(int id)
    {
        var svc = await ServiceWithLibraryAsync();

        Assert.Null(await svc.UpdateOffsetsAsync(id, tlo: -5));
        Assert.All(await svc.GetLibraryAsync(), t => Assert.Equal(0, t.Offsets.Tlo));
    }

    [Fact]
    public async Task UpdateOffsets_sends_clients_the_new_list()
    {
        var svc = await ServiceWithLibraryAsync();
        _broadcaster.Invocations.Clear();
        var id = (await svc.GetLibraryAsync()).First().Id;

        await svc.UpdateOffsetsAsync(id, tlo: -1);

        _broadcaster.Verify(b => b.Broadcast("tools-updated", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public async Task GetById_reads_the_stored_library()
    {
        var svc = await ServiceWithLibraryAsync();
        Magazine(4);
        Numbering(ToolNumbering.Slot);
        var id = (await svc.GetLibraryAsync()).Single(t => t.Name == "Compression").Id;

        var tool = await svc.GetByIdAsync(id);

        Assert.Equal(300, tool!.ToolId);   // its own ID, not the slot number
    }

    // --- Default: Slot on a fresh install; Tool ID kept for library users -

    private System.Text.Json.Nodes.JsonObject? SavedPatch;

    private void TrackSaves() =>
        _settings.Setup(s => s.SaveSettings(It.IsAny<System.Text.Json.Nodes.JsonObject>()))
            .Callback<System.Text.Json.Nodes.JsonObject>(p => SavedPatch = p)
            .Returns(Task.CompletedTask);

    private string? SavedNumbering => SavedPatch?["tool"]?["numbering"]?.GetValue<string>();

    [Fact]
    public async Task Unset_with_tools_in_the_library_keeps_Tool_ID()
    {
        var svc = await ServiceWithLibraryAsync();
        TrackSaves();

        await svc.DecideNumberingAsync();

        Assert.Equal(ToolNumbering.ToolId, SavedNumbering);
    }

    [Fact]
    public async Task Unset_with_an_empty_library_is_Slot()
    {
        var svc = CreateService();
        TrackSaves();

        await svc.DecideNumberingAsync();

        Assert.Equal(ToolNumbering.Slot, SavedNumbering);
    }

    [Theory]
    [InlineData(true, ToolNumbering.ToolId)]
    [InlineData(false, ToolNumbering.Slot)]
    public async Task An_earlier_Use_Tool_Library_choice_carries_over(bool useLibrary, string expected)
    {
        var svc = CreateService();
        _settings.Setup(s => s.GetSetting("tool.useLibrary", null))
            .Returns(System.Text.Json.Nodes.JsonValue.Create(useLibrary));
        TrackSaves();

        await svc.DecideNumberingAsync();

        Assert.Equal(expected, SavedNumbering);
    }

    [Fact]
    public async Task A_numbering_the_user_set_is_never_changed()
    {
        var svc = await ServiceWithLibraryAsync();
        _settings.Setup(s => s.GetSetting(ToolNumbering.Setting, null))
            .Returns(System.Text.Json.Nodes.JsonValue.Create(ToolNumbering.Slot));
        TrackSaves();

        await svc.DecideNumberingAsync();

        Assert.Null(SavedPatch);
    }

    [Fact]
    public void Fresh_install_defaults_to_Slot()
    {
        var dir = Path.Combine(_tempDir, "fresh");
        Directory.CreateDirectory(dir);
        var settings = new NcSender.Server.Configuration.SettingsManager(Path.Combine(dir, "settings.json"));

        Assert.True(ToolNumbering.IsSlot(settings));
        Assert.Equal(ToolNumbering.Slot, settings.GetSetting<string>(ToolNumbering.Setting, ""));
    }

    [Theory]
    [InlineData("numbering")]
    [InlineData("count")]
    [InlineData("probe")]
    public void Changing_a_numbering_setting_sends_clients_the_new_list(string key)
    {
        _ = CreateService();

        _settings.Raise(s => s.SettingsSaved += null,
            new System.Text.Json.Nodes.JsonObject { ["tool"] = new System.Text.Json.Nodes.JsonObject { [key] = 1 } });

        _broadcaster.Verify(b => b.Broadcast("tools-updated", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public void Unrelated_settings_do_not_resend_the_list()
    {
        _ = CreateService();

        _settings.Raise(s => s.SettingsSaved += null,
            new System.Text.Json.Nodes.JsonObject { ["tool"] = new System.Text.Json.Nodes.JsonObject { ["tls"] = true } });

        _broadcaster.Verify(b => b.Broadcast("tools-updated", It.IsAny<JsonElement>()), Times.Never);
    }
}
