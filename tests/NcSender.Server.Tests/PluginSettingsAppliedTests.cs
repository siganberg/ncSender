using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Plugins;

namespace NcSender.Server.Tests;

/// <summary>
/// onSettingsApplied: the hook where a plugin publishes what follows from its
/// settings (accessory roles, zones in Pro). It used to live in each plugin's
/// settings page and ran only on Save, so an updated plugin did nothing until
/// the user opened the page and saved again. The app now calls the hook
/// whenever the plugin is loaded and when the controller connects.
/// </summary>
public class PluginSettingsAppliedTests : IDisposable
{
    private readonly JsPluginEngine _engine;
    private readonly DirectoryInfo _dir = Directory.CreateTempSubdirectory();
    private readonly string _settingsPath = Path.Combine(Path.GetTempPath(), $"psa-{Guid.NewGuid():N}.json");
    private readonly NcSender.Server.Configuration.SettingsManager _settings;
    private readonly Mock<IBroadcaster> _broadcaster = new();
    private readonly Mock<IFirmwareService> _firmware = new();
    private readonly List<string> _ids = [];

    public PluginSettingsAppliedTests()
    {
        _settings = new NcSender.Server.Configuration.SettingsManager(_settingsPath);
        _broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        var services = new Mock<IServiceProvider>();
        services.Setup(s => s.GetService(typeof(ISettingsManager))).Returns(_settings);
        services.Setup(s => s.GetService(typeof(IBroadcaster))).Returns(_broadcaster.Object);
        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState());
        _engine = new JsPluginEngine(
            NullLogger<JsPluginEngine>.Instance,
            new PluginDialogDispatcher(new Mock<IBroadcaster>().Object, NullLogger<PluginDialogDispatcher>.Instance),
            new Mock<IGateService>().Object, new Mock<IToolService>().Object, new Mock<IDongleDeviceService>().Object,
            new Mock<NcSender.Server.Tools.IPendingToolTloWriteback>().Object, serverContext.Object,
            _firmware.Object, new Mock<ICncController>().Object, services.Object);
    }

    public void Dispose()
    {
        foreach (var id in _ids) _engine.UnloadPlugin(id);
        _dir.Delete(true);
        try { File.Delete(_settingsPath); } catch { }
    }

    private string Load(string script, Dictionary<string, JsonElement>? settings = null, string? id = null)
    {
        id ??= $"psa{Guid.NewGuid():N}";
        if (!_ids.Contains(id)) _ids.Add(id);
        var file = Path.Combine(_dir.FullName, $"{id}.js");
        File.WriteAllText(file, "function buildInitialConfig(raw) { return { slots: raw.slots || 4 }; }\nvar seen = [];\n" + script);
        _engine.LoadPlugin(id, file, settings ?? new());
        return id;
    }

    private async Task<string?> Seen(string id)
    {
        await _engine.ToolChangeHooksIdle;
        return _engine.EvaluateForTest(id, "seen.join(',')");
    }

    private static FirmwareData Firmware(string x, string y) => new()
    {
        Settings = new() { ["130"] = new FirmwareSetting { Value = x }, ["131"] = new FirmwareSetting { Value = y } },
    };


    // ---- the hook ---------------------------------------------------------

    [Fact]
    public async Task The_hook_runs_when_the_plugin_is_loaded_with_its_settings()
    {
        var id = Load("function onSettingsApplied(s, info) { seen.push(info.reason + ':' + s.slots); }",
            new() { ["slots"] = JsonSerializer.SerializeToElement(6) });
        Assert.Equal("load:6", await Seen(id));
    }

    [Fact]
    public async Task Loading_it_again_as_an_update_or_a_save_does_runs_it_again()
    {
        const string script = "function onSettingsApplied(s, info) { seen.push(info.reason + ':' + s.slots); }";
        var id = Load(script, new() { ["slots"] = JsonSerializer.SerializeToElement(4) });
        Assert.Equal("load:4", await Seen(id));
        Load(script, new() { ["slots"] = JsonSerializer.SerializeToElement(8) }, id);
        Assert.Equal("load:8", await Seen(id));
    }

    [Fact]
    public async Task It_runs_again_in_every_plugin_when_the_controller_connects()
    {
        var a = Load("function onSettingsApplied(s, info) { seen.push(info.reason); }");
        var b = Load("function onSettingsApplied(s, info) { seen.push(info.reason); }");
        _engine.NotifySettingsApplied("connected");
        Assert.Equal("load,connected", await Seen(a));
        Assert.Equal("load,connected", await Seen(b));
    }

    [Fact]
    public async Task A_plugin_without_the_hook_and_one_whose_hook_throws_stop_nobody()
    {
        var plain = Load("function onBeforeCommand(c) { return c; }");
        var broken = Load("function onSettingsApplied() { seen.push('ran'); throw new Error('boom'); }");
        var good = Load("function onSettingsApplied(s, info) { seen.push(info.reason); }");
        _engine.NotifySettingsApplied("connected");
        Assert.Equal("", await Seen(plain));
        Assert.Equal("ran,ran", await Seen(broken));
        Assert.Equal("load,connected", await Seen(good));
    }

    // ---- pluginContext.getMachineLimits -----------------------------------

    [Theory]
    [InlineData("back-left", 0, 1200, -800, 0)]
    [InlineData("back-right", -1200, 0, -800, 0)]
    [InlineData("front-left", 0, 1200, 0, 800)]
    [InlineData("front-right", -1200, 0, 0, 800)]
    [InlineData(null, 0, 1200, -800, 0)]
    public void The_travel_runs_from_machine_zero_towards_the_bed(string? home, double minX, double maxX, double minY, double maxY)
    {
        Assert.Equal((minX, maxX, minY, maxY), JsPluginEngine.MachineLimits(Firmware("1200.000", "800.000"), home));
    }

    [Fact]
    public void No_travel_from_the_controller_means_no_limits()
    {
        Assert.Null(JsPluginEngine.MachineLimits(null, "back-left"));
        Assert.Null(JsPluginEngine.MachineLimits(new FirmwareData(), "back-left"));
        Assert.Null(JsPluginEngine.MachineLimits(Firmware("0", "800"), "back-left"));
    }

    [Fact]
    public async Task A_plugin_reads_the_limits_and_null_before_the_controller_is_known()
    {
        const string script = "function onSettingsApplied() { var l = pluginContext.getMachineLimits(); seen.push(l ? [l.minX, l.maxX, l.minY, l.maxY].join('/') : 'null'); }";
        var id = Load(script);
        Assert.Equal("null", await Seen(id));

        _firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync(Firmware("1213.499", "810.531"));
        _engine.NotifySettingsApplied("connected");
        Assert.Equal("null,0/1213.499/-810.531/0", await Seen(id));
    }
}
