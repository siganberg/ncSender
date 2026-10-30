using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// GitHub #78: plugins get onControllerError once for each error:n and ALARM:n.
public class ControllerErrorHookTests
{
    private static (NcSender.Server.Plugins.JsPluginEngine engine, ControllerErrorFeed feed, ServerState state) Make()
    {
        var feed = new ControllerErrorFeed();
        var state = new ServerState();
        var context = new Mock<IServerContext>();
        context.Setup(c => c.State).Returns(state);
        var engine = new NcSender.Server.Plugins.JsPluginEngine(
            NullLogger<NcSender.Server.Plugins.JsPluginEngine>.Instance,
            new NcSender.Server.Plugins.PluginDialogDispatcher(new Mock<IBroadcaster>().Object, NullLogger<NcSender.Server.Plugins.PluginDialogDispatcher>.Instance),
            new Mock<IGateService>().Object, new Mock<IToolService>().Object, new Mock<IDongleDeviceService>().Object,
            new Mock<NcSender.Server.Tools.IPendingToolTloWriteback>().Object, context.Object,
            new Mock<IFirmwareService>().Object, new Mock<ICncController>().Object, new Mock<IServiceProvider>().Object, null, feed);
        return (engine, feed, state);
    }

    private static string Load(NcSender.Server.Plugins.JsPluginEngine engine, string id, string body)
    {
        var dir = Directory.CreateTempSubdirectory();
        var file = Path.Combine(dir.FullName, "commands.js");
        File.WriteAllText(file, "function buildInitialConfig(raw) { return raw; }\n" + body);
        engine.LoadPlugin(id, file, new());
        return dir.FullName;
    }

    [Fact]
    public async Task Plugin_receives_errors_and_alarms_with_their_context()
    {
        var (engine, feed, state) = Make();
        var dir = Load(engine, "test.errors", """
            var seen = [];
            function onControllerError(e) { seen.push([e.type, e.code, e.message, e.raw, e.command, e.sourceId, e.jobRunning, e.line, e.file, typeof e.timestamp].join(' ')); }
            export { onControllerError };
            """);

        feed.Publish(new CncError { Code = "20", Message = "Unsupported command", Raw = "error:20", Command = "G5", SourceId = "client" });
        state.JobLoaded = new JobInfo { Filename = "part.nc", Status = "running", CurrentLine = 42 };
        feed.Publish(new CncError { Code = "ALARM", AlarmCode = 1, Message = "ALARM:1", AlarmDescription = "Hard limit", Raw = "ALARM:1" });
        await engine.ToolChangeHooksIdle;

        Assert.Equal("error 20 Unsupported command error:20 G5 client false   string|alarm 1 Hard limit ALARM:1   true 42 part.nc string",
            engine.EvaluateForTest("test.errors", "seen.join('|')"));
        Directory.Delete(dir, true);
    }

    [Fact]
    public async Task A_failing_plugin_does_not_stop_the_next_one()
    {
        var (engine, feed, _) = Make();
        var a = Load(engine, "test.bad", "function onControllerError(e) { throw new Error('boom'); }\nexport { onControllerError };");
        var b = Load(engine, "test.good", "var n = 0;\nfunction onControllerError(e) { n++; }\nexport { onControllerError };");

        feed.Publish(new CncError { Code = "9", Message = "Locked" });
        await engine.ToolChangeHooksIdle;

        Assert.Equal("1", engine.EvaluateForTest("test.good", "n"));
        Directory.Delete(a, true);
        Directory.Delete(b, true);
    }
}
