using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Plugins;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// What a plugin sees of the running machine and the loaded program: the
// AutoDustBoot safe zones time the boot from these.
public class PluginMotionApiTests
{
    [Fact]
    public async Task Plugins_see_position_line_overrides_and_the_timed_program()
    {
        var state = new ServerState();
        state.MachineState.Status = "Run";
        state.MachineState.MPos = "-120.5,-300.25,-10";
        state.MachineState.WCO = "-400,-500,-80.5";
        state.MachineState.FeedrateOverride = 120;
        state.MachineState.RapidOverride = 50;
        state.MachineState.FeedRate = 1500;
        state.JobLoaded = new JobInfo { Status = "running", CurrentLine = 42 };
        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(state);

        var files = new Mock<IGcodeFileService>();
        files.Setup(f => f.GetLoadedProgramAsync())
            .ReturnsAsync(new LoadedProgram("G0 X0\nG1 X100 F1200\nM5", [0, 5.05, 0], new DateTime(2026, 11, 6, 0, 0, 0, DateTimeKind.Utc)));
        var services = new Mock<IServiceProvider>();
        services.Setup(s => s.GetService(typeof(IGcodeFileService))).Returns(files.Object);

        var engine = new JsPluginEngine(
            NullLogger<JsPluginEngine>.Instance,
            new PluginDialogDispatcher(new Mock<IBroadcaster>().Object, NullLogger<PluginDialogDispatcher>.Instance),
            new Mock<IGateService>().Object, new Mock<IToolService>().Object, new Mock<IDongleDeviceService>().Object,
            new Mock<NcSender.Server.Tools.IPendingToolTloWriteback>().Object, serverContext.Object,
            new Mock<IFirmwareService>().Object, new Mock<ICncController>().Object, services.Object);
        var dir = Directory.CreateTempSubdirectory();
        var file = Path.Combine(dir.FullName, "commands.js");
        File.WriteAllText(file, """
            function buildInitialConfig(raw) { return raw; }
            function onBeforeCommand(commands) {
              var s = pluginContext.getServerState();
              var p = pluginContext.getProgram();
              var seen = [s.machineStatus, s.mpos.x, s.mpos.y, s.wco.z, s.line, s.feedOverride, s.rapidOverride, s.feedRate,
                          p.text.split('\n').length, p.lineSec.length, p.lineSec[1], typeof p.stamp];
              return [{ command: seen.join('|'), isOriginal: false }];
            }
            """);
        try
        {
            engine.LoadPlugin("motion", file, new());
            var result = await engine.ProcessOnBeforeCommandAsync("motion", [new() { Command = "G0 X1" }], new CommandProcessorContext(), []);
            Assert.Equal("Run|-120.5|-300.25|-80.5|42|120|50|1500|3|3|5.05|string", result[0].Command);
        }
        finally
        {
            engine.UnloadPlugin("motion");
            dir.Delete(true);
        }
    }

    [Fact]
    public async Task GetProgram_is_null_when_nothing_is_loaded()
    {
        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState());
        var files = new Mock<IGcodeFileService>();
        files.Setup(f => f.GetLoadedProgramAsync()).ReturnsAsync((LoadedProgram?)null);
        var services = new Mock<IServiceProvider>();
        services.Setup(s => s.GetService(typeof(IGcodeFileService))).Returns(files.Object);
        var engine = new JsPluginEngine(
            NullLogger<JsPluginEngine>.Instance,
            new PluginDialogDispatcher(new Mock<IBroadcaster>().Object, NullLogger<PluginDialogDispatcher>.Instance),
            new Mock<IGateService>().Object, new Mock<IToolService>().Object, new Mock<IDongleDeviceService>().Object,
            new Mock<NcSender.Server.Tools.IPendingToolTloWriteback>().Object, serverContext.Object,
            new Mock<IFirmwareService>().Object, new Mock<ICncController>().Object, services.Object);
        var dir = Directory.CreateTempSubdirectory();
        var file = Path.Combine(dir.FullName, "commands.js");
        File.WriteAllText(file, """
            function buildInitialConfig(raw) { return raw; }
            function onBeforeCommand(commands) {
              var s = pluginContext.getServerState();
              return [{ command: String(pluginContext.getProgram()) + '|' + s.line + '|' + s.mpos.x, isOriginal: false }];
            }
            """);
        try
        {
            engine.LoadPlugin("motion", file, new());
            var result = await engine.ProcessOnBeforeCommandAsync("motion", [new() { Command = "G0 X1" }], new CommandProcessorContext(), []);
            Assert.Equal("null|0|0", result[0].Command);
        }
        finally
        {
            engine.UnloadPlugin("motion");
            dir.Delete(true);
        }
    }
}
