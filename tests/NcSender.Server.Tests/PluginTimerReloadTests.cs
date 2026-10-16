using System.Collections.Concurrent;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Plugins;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// A plugin reload replaces its engine. The old engine's setInterval timers
// kept firing next to the new ones (the pneumaticatc tool sensor watch then
// opened the old and the new dialog together).
public class PluginTimerReloadTests
{
    [Fact]
    public async Task Reload_stops_the_old_engines_timers()
    {
        var sent = new ConcurrentQueue<string>();
        var controller = new Mock<ICncController>();
        controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .Callback<string, CommandOptions?, CancellationToken>((cmd, _, _) => sent.Enqueue(cmd))
            .ReturnsAsync(new CommandResult());
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
        string Script(string word) => $$"""
            function buildInitialConfig(raw) { return raw; }
            pluginContext.setInterval(function () { pluginContext.sendCommand('{{word}}'); }, 50);
            """;
        try
        {
            File.WriteAllText(file, Script("OLD"));
            engine.LoadPlugin("watch", file, new());
            await Task.Delay(200);
            File.WriteAllText(file, Script("NEW"));
            engine.LoadPlugin("watch", file, new());
            await Task.Delay(200);
            sent.Clear();
            await Task.Delay(400);

            Assert.Contains("NEW", sent);
            Assert.DoesNotContain("OLD", sent);
        }
        finally
        {
            engine.UnloadPlugin("watch");
            dir.Delete(true);
        }
    }
}
