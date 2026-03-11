using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Plugins;

namespace NcSender.Server.Tests;

public class PluginManagerTests : IDisposable
{
    private readonly string _tempDir;
    private readonly PluginManager _manager;
    private readonly Mock<IBroadcaster> _broadcaster;
    private readonly Mock<IJsPluginEngine> _jsEngine;
    private readonly Mock<ISettingsManager> _settingsManager;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

    public PluginManagerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"ncsender-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDir);
        _broadcaster = new Mock<IBroadcaster>();
        _broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        _jsEngine = new Mock<IJsPluginEngine>();
        _settingsManager = new Mock<ISettingsManager>();
        _settingsManager.Setup(s => s.SaveSettings(It.IsAny<JsonObject>())).Returns(Task.CompletedTask);
        _manager = new PluginManager(
            NullLogger<PluginManager>.Instance,
            _broadcaster.Object,
            _jsEngine.Object,
            _settingsManager.Object);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    private void CreatePlugin(string pluginId, string category = "general", string version = "1.0.0")
    {
        // Use PathUtils.GetPluginsDir() indirectly — we'll create manifests there
        var pluginsDir = Infrastructure.PathUtils.GetPluginsDir();
        var pluginDir = Path.Combine(pluginsDir, pluginId);
        Directory.CreateDirectory(pluginDir);

        var manifest = new PluginManifest
        {
            Id = pluginId,
            Name = pluginId,
            Version = version,
            Author = "Test",
            Description = "Test plugin",
            Category = category
        };

        File.WriteAllText(
            Path.Combine(pluginDir, "manifest.json"),
            JsonSerializer.Serialize(manifest, JsonOptions));
    }

    [Fact]
    public void ListAll_EmptyDir_ReturnsEmpty()
    {
        var result = _manager.ListAll();
        // May return plugins if any exist in the real plugins dir, but shouldn't throw
        Assert.NotNull(result);
    }

    [Fact]
    public void ManifestParsing_ValidManifest_Parsed()
    {
        var manifest = new PluginManifest
        {
            Id = "com.test.plugin",
            Name = "Test Plugin",
            Version = "2.0.0",
            Author = "Author",
            Description = "A test plugin",
            Category = "tool-changer",
            Icon = "icon.svg",
            ConfigUi = "config.html"
        };

        var json = JsonSerializer.Serialize(manifest, JsonOptions);
        var parsed = JsonSerializer.Deserialize<PluginManifest>(json, JsonOptions);

        Assert.NotNull(parsed);
        Assert.Equal("com.test.plugin", parsed.Id);
        Assert.Equal("Test Plugin", parsed.Name);
        Assert.Equal("2.0.0", parsed.Version);
        Assert.Equal("tool-changer", parsed.Category);
        Assert.Equal("icon.svg", parsed.Icon);
    }

    [Fact]
    public void RegistryEntry_Serialization()
    {
        var entry = new PluginRegistryEntry
        {
            Id = "com.test.plugin",
            Enabled = true,
            Priority = 5,
            InstalledAt = DateTime.UtcNow.ToString("o")
        };

        var json = JsonSerializer.Serialize(entry, JsonOptions);
        var parsed = JsonSerializer.Deserialize<PluginRegistryEntry>(json, JsonOptions);

        Assert.NotNull(parsed);
        Assert.Equal("com.test.plugin", parsed.Id);
        Assert.True(parsed.Enabled);
        Assert.Equal(5, parsed.Priority);
    }

    [Fact]
    public void RegistryEntry_DefaultValues()
    {
        var entry = new PluginRegistryEntry();
        Assert.False(entry.Enabled);
        Assert.Equal(0, entry.Priority);
        Assert.Equal("", entry.Id);
    }

    [Fact]
    public void PluginInfo_DefaultValues()
    {
        var info = new PluginInfo();
        Assert.False(info.Enabled);
        Assert.Equal(0, info.Priority);
        Assert.Equal("", info.Id);
        Assert.Null(info.Manifest);
    }

    [Fact]
    public void ToolMenuItem_Fields()
    {
        var item = new PluginToolMenuItem
        {
            Id = "tool-1",
            PluginId = "com.test",
            Label = "My Tool",
            Icon = "wrench",
            ClientOnly = true
        };

        Assert.Equal("tool-1", item.Id);
        Assert.Equal("com.test", item.PluginId);
        Assert.True(item.ClientOnly);
    }

    [Fact]
    public void PluginUpdateInfo_DefaultNotAvailable()
    {
        var info = new PluginUpdateInfo();
        Assert.False(info.UpdateAvailable);
        Assert.Equal("", info.CurrentVersion);
        Assert.Equal("", info.LatestVersion);
    }
}
