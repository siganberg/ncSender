using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Plugins;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// An enabled plugin either runs or motion is refused. AutoDustBoot was
// quarantined after an interrupted startup and skipped silently, so jobs ran
// with the boot down.
public class PluginMustRunTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("ncsender-plugin-run").FullName;
    public void Dispose() => Directory.Delete(_dir, true);

    // --- Quarantine needs two failed startups in a row ---

    [Fact]
    public void One_interrupted_startup_does_not_quarantine()
    {
        var marker = Path.Combine(_dir, "adb");
        PluginManager.WriteLoadingMarker(marker, "0.3.15");      // startup killed while loading
        Assert.False(PluginManager.IsQuarantinedMarker(marker, "0.3.15"));
    }

    [Fact]
    public void Two_failed_startups_in_a_row_quarantine()
    {
        var marker = Path.Combine(_dir, "adb");
        PluginManager.WriteLoadingMarker(marker, "0.3.15");
        PluginManager.WriteLoadingMarker(marker, "0.3.15");      // died again on the retry
        Assert.True(PluginManager.IsQuarantinedMarker(marker, "0.3.15"));
    }

    [Fact]
    public void A_new_version_starts_counting_again()
    {
        var marker = Path.Combine(_dir, "adb");
        PluginManager.WriteLoadingMarker(marker, "0.3.15");
        PluginManager.WriteLoadingMarker(marker, "0.3.15");
        Assert.False(PluginManager.IsQuarantinedMarker(marker, "0.3.16"));
        PluginManager.WriteLoadingMarker(marker, "0.3.16");
        Assert.False(PluginManager.IsQuarantinedMarker(marker, "0.3.16"));
    }

    [Fact]
    public void An_old_version_only_marker_counts_as_one_failure()
    {
        var marker = Path.Combine(_dir, "adb");
        File.WriteAllText(marker, "0.3.15");                     // written by the previous release
        Assert.False(PluginManager.IsQuarantinedMarker(marker, "0.3.15"));
        PluginManager.WriteLoadingMarker(marker, "0.3.15");
        Assert.True(PluginManager.IsQuarantinedMarker(marker, "0.3.15"));
    }

    // --- What blocks motion ---

    private static PluginInfo Plugin(string id, string name, string? runState = null, params string[] events) => new()
    {
        Id = id, Name = name, Enabled = true, RunState = runState,
        Manifest = new PluginManifest { Id = id, Name = name, Commands = "commands.js", Events = [.. events] },
    };

    [Fact]
    public void An_enabled_plugin_that_changes_commands_and_is_not_running_blocks()
    {
        var adb = Plugin("adb", "AutoDustBoot", "quarantined", "onBeforeCommand", "onGcodeProgramLoad");
        var blocker = PluginManager.MotionBlocker([adb], _ => false, []);
        Assert.Contains("AutoDustBoot is enabled but not running", blocker);
        Assert.Contains("quarantined", blocker);
    }

    [Fact]
    public void A_failed_load_says_why()
    {
        var adb = Plugin("adb", "AutoDustBoot", "failed", "onBeforeCommand");
        adb.RunError = "SyntaxError: Unexpected token";
        Assert.Contains("failed to load: SyntaxError", PluginManager.MotionBlocker([adb], _ => false, []));
    }

    [Fact]
    public void Running_plugins_and_display_only_plugins_do_not_block()
    {
        var adb = Plugin("adb", "AutoDustBoot", "running", "onBeforeCommand");
        var rgb = Plugin("rgb", "RGB LED", "quarantined", "background");   // no motion of its own
        Assert.Null(PluginManager.MotionBlocker([adb, rgb], id => id == "adb", []));
    }

    [Fact]
    public void A_program_loaded_while_the_plugin_was_broken_blocks_until_reloaded()
    {
        var adb = Plugin("adb", "AutoDustBoot", "running", "onGcodeProgramLoad");
        var blocker = PluginManager.MotionBlocker([adb], _ => true, ["adb\tAutoDustBoot (not running)"]);
        Assert.Contains("The loaded program was not prepared by AutoDustBoot (not running)", blocker);
    }

    [Fact]
    public void Disabling_the_plugin_lifts_the_program_block()
    {
        // The plugin is no longer in the enabled list: running without it is the user's choice.
        Assert.Null(PluginManager.MotionBlocker([], _ => true, ["adb\tAutoDustBoot (not running)"]));
    }

    // --- Refusing commands ---

    private static NcSender.Server.CommandProcessor.PluginCommandProcessor Processor(
        MachineState ms, Func<List<ProcessedCommand>> plugin, string? blocker = null)
    {
        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState { MachineState = ms });
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        var firmware = new Mock<IFirmwareService>();
        firmware.Setup(f => f.GetCachedAsync()).ReturnsAsync((FirmwareData?)null);
        var settings = new Mock<ISettingsManager>();
        var projection = new NcSender.Server.CommandProcessor.ToolProjection(NullLogger<NcSender.Server.CommandProcessor.ToolProjection>.Instance);
        var inner = new NcSender.Server.CommandProcessor.CommandProcessor(
            serverContext.Object, broadcaster.Object, firmware.Object, settings.Object,
            new Mock<IMacroService>().Object, projection, NullLogger<NcSender.Server.CommandProcessor.CommandProcessor>.Instance);
        var engine = new Mock<IJsPluginEngine>();
        engine.Setup(e => e.GetLoadedPluginIds()).Returns(["adb"]);
        engine.Setup(e => e.ProcessOnBeforeCommandAsync(It.IsAny<string>(), It.IsAny<List<ProcessedCommand>>(),
                It.IsAny<CommandProcessorContext>(), It.IsAny<List<ToolInfo>>()))
            .ReturnsAsync(() => plugin());
        var tools = new Mock<IToolService>();
        tools.Setup(t => t.GetAllAsync()).ReturnsAsync(new List<ToolInfo>());
        var plugins = new Mock<IPluginManager>();
        plugins.Setup(p => p.GetMotionBlocker()).Returns(blocker);
        return new NcSender.Server.CommandProcessor.PluginCommandProcessor(
            inner, engine.Object, tools.Object, serverContext.Object, broadcaster.Object, settings.Object, projection,
            NullLogger<NcSender.Server.CommandProcessor.PluginCommandProcessor>.Instance, null, plugins.Object);
    }

    private static CommandProcessorContext Ctx(MachineState ms, string source) => new()
    {
        MachineState = ms, LineNumber = 1, Meta = new CommandMeta { SourceId = source },
    };

    private static readonly MachineState Idle = new() { Status = "Idle", Tool = 1, MPos = "0,0,0", WCO = "0,0,0" };

    [Fact]
    public async Task A_plugin_that_throws_refuses_the_command_and_stops_a_job()
    {
        var processor = Processor(Idle, () => throw new PluginCommandException("adb", "boom", new Exception("boom")));
        var result = await processor.ProcessAsync("G0 X10", Ctx(Idle, "job"));
        Assert.False(result.ShouldContinue);
        Assert.Empty(result.Commands);                   // nothing sent without the plugin's lines
        Assert.Contains("adb", result.Error);            // the job stops on it
    }

    [Theory]
    [InlineData("M6 T5")]
    [InlineData("$TLS")]
    public async Task A_manual_tool_change_is_refused_while_a_plugin_is_not_running(string command)
    {
        var processor = Processor(Idle, () => [new() { Command = "G53 G0 Z0", IsOriginal = false }], "AutoDustBoot is enabled but not running");
        var result = await processor.ProcessAsync(command, Ctx(Idle, "client"));
        Assert.False(result.ShouldContinue);
        Assert.Contains("AutoDustBoot", result.SkipReason);
    }

    [Fact]
    public async Task With_every_plugin_running_the_tool_change_goes_ahead()
    {
        var processor = Processor(Idle, () => [new() { Command = "G53 G0 Z0", IsOriginal = false }]);
        var result = await processor.ProcessAsync("M6 T5", Ctx(Idle, "client"));
        Assert.True(result.ShouldContinue);
    }
}

// The real engine: a throwing onBeforeCommand is reported, not swallowed.
public class PluginEngineFailureTests
{
    [Fact]
    public async Task A_throwing_onBeforeCommand_surfaces_as_PluginCommandException()
    {
        var controller = new Mock<ICncController>();
        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState());
        var engine = new JsPluginEngine(
            NullLogger<JsPluginEngine>.Instance,
            new PluginDialogDispatcher(new Mock<IBroadcaster>().Object, NullLogger<PluginDialogDispatcher>.Instance),
            new Mock<IGateService>().Object, new Mock<IToolService>().Object, new Mock<IDongleDeviceService>().Object,
            new Mock<NcSender.Server.Tools.IPendingToolTloWriteback>().Object, serverContext.Object,
            new Mock<IFirmwareService>().Object, controller.Object, new Mock<IServiceProvider>().Object);
        var dir = Directory.CreateTempSubdirectory();
        var file = Path.Combine(dir.FullName, "commands.js");
        File.WriteAllText(file, """
            function buildInitialConfig(raw) { return raw; }
            function onBeforeCommand(c) { throw new Error('dock sensor missing'); }
            """);
        engine.LoadPlugin("adb", file, new());

        var ex = await Assert.ThrowsAsync<PluginCommandException>(() =>
            engine.ProcessOnBeforeCommandAsync("adb", [new() { Command = "G0 X1" }], new CommandProcessorContext(), []));
        Assert.Contains("dock sensor missing", ex.Message);
        dir.Delete(true);
    }
}
