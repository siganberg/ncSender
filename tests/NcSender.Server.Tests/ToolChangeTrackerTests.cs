using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.CommandProcessor;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// GitHub #77: plugins get onToolChangeStart / onToolChangeEnd so they can tell
// a tool change that ran to the end from one that was cut short. Every start
// has exactly one end.
public class ToolChangeTrackerTests
{
    private readonly Mock<ICncController> _controller = new();
    private readonly ToolChangeTracker _tracker;
    private readonly List<string> _events = [];

    public ToolChangeTrackerTests()
    {
        _tracker = new ToolChangeTracker(_controller.Object, NullLogger<ToolChangeTracker>.Instance);
        _tracker.Started += e => _events.Add($"start {e.Info.Kind} T{e.Info.Tool}");
        _tracker.Ended += e => { _events.Add($"end {e.Info.Kind} T{e.Info.Tool} {e.Outcome}{(e.Reason is null ? "" : " " + e.Reason)}"); _lastEnd = e; };
    }

    private int Register(int tool = 5, string kind = "M6") =>
        _tracker.Register(new ToolChangeInfo(kind, tool, 1, $"M6 T{tool}", "client", false));

    private void Echo(string line) => _controller.Raise(c => c.DataReceived += null, line, (string?)null);
    private void Ack(string command, string status) =>
        _controller.Raise(c => c.CommandAcknowledged += null, new CommandResult { Command = command, Status = status });

    [Fact]
    public void Completed_when_the_complete_sentinel_comes_back()
    {
        var id = Register();
        Echo($"[MSG:TOOL_CHANGE_START {id}]");
        Echo($"[MSG:TOOL_CHANGE_COMPLETE {id}]");
        Assert.Equal(["start M6 T5", "end M6 T5 completed"], _events);
    }

    [Fact]
    public void A_rejected_line_aborts_and_the_cleanup_sentinel_after_it_does_not_complete()
    {
        // The COMPLETE sentinel is a cleanup line: it is still sent after the
        // controller rejects a line, so it must not turn the abort into a success.
        var id = Register();
        Echo($"[MSG:TOOL_CHANGE_START {id}]");
        Ack("G38.2 Z-50 F200", "error");
        Echo($"[MSG:TOOL_CHANGE_COMPLETE {id}]");
        Assert.Equal(["start M6 T5", "end M6 T5 aborted error"], _events);
    }

    [Theory]
    [InlineData("stopped")]
    [InlineData("alarm")]
    [InlineData("disconnected")]
    public void Stop_alarm_and_disconnect_abort(string reason)
    {
        var id = Register();
        Echo($"[MSG:TOOL_CHANGE_START {id}]");
        switch (reason)
        {
            case "stopped": _controller.Raise(c => c.StopReceived += null); break;
            case "alarm": _controller.Raise(c => c.ErrorReceived += null, new CncError { Code = "ALARM", AlarmCode = 4 }); break;
            case "disconnected": _controller.Raise(c => c.ConnectionStatusChanged += null, "disconnected", false); break;
        }
        Assert.Equal(["start M6 T5", $"end M6 T5 aborted {reason}"], _events);
    }

    [Fact]
    public void A_refused_jog_does_not_abort()
    {
        var id = Register();
        Echo($"[MSG:TOOL_CHANGE_START {id}]");
        Ack("$J=G91 X10 F1000", "error");
        Echo($"[MSG:TOOL_CHANGE_COMPLETE {id}]");
        Assert.Equal(["start M6 T5", "end M6 T5 completed"], _events);
    }

    [Fact]
    public void Nothing_is_reported_outside_a_tool_change()
    {
        Ack("G0 X10", "error");
        _controller.Raise(c => c.StopReceived += null);
        Echo("[MSG:TOOL_CHANGE_COMPLETE 99]");
        Assert.Empty(_events);
    }

    [Fact]
    public void Several_changes_in_one_macro_each_start_and_end()
    {
        var a = Register(1); var b = Register(2);
        Echo($"[MSG:TOOL_CHANGE_START {a}]"); Echo($"[MSG:TOOL_CHANGE_COMPLETE {a}]");
        Echo($"[MSG:TOOL_CHANGE_START {b}]"); Echo($"[MSG:TOOL_CHANGE_COMPLETE {b}]");
        Assert.Equal(["start M6 T1", "end M6 T1 completed", "start M6 T2", "end M6 T2 completed"], _events);
    }

    [Fact]
    public void A_tls_inside_a_tool_change_is_not_reported_on_its_own()
    {
        var outer = Register(5); var inner = Register(5, "TLS");
        Echo($"[MSG:TOOL_CHANGE_START {outer}]");
        Echo($"[MSG:TOOL_CHANGE_START {inner}]");
        Echo($"[MSG:TOOL_CHANGE_COMPLETE {inner}]");
        Assert.Equal(["start M6 T5"], _events);
        Echo($"[MSG:TOOL_CHANGE_COMPLETE {outer}]");
        Assert.Equal(["start M6 T5", "end M6 T5 completed"], _events);
    }

    [Fact]
    public void A_reset_drops_sequences_that_never_started()
    {
        var a = Register(1); var b = Register(2);
        Echo($"[MSG:TOOL_CHANGE_START {a}]");
        _controller.Raise(c => c.StopReceived += null);   // b was flushed with the queue
        Echo($"[MSG:TOOL_CHANGE_START {b}]");
        Assert.Equal(["start M6 T1", "end M6 T1 aborted stopped"], _events);
    }

    [Fact]
    public void A_tls_reports_its_own_kind()
    {
        var id = Register(3, "TLS");
        Echo($"[MSG:TOOL_CHANGE_START {id}]");
        Echo($"[MSG:TOOL_CHANGE_COMPLETE {id}]");
        Assert.Equal(["start TLS T3", "end TLS T3 completed"], _events);
    }

    [Theory]
    [InlineData("[MSG:TOOL_CHANGE_START 7]", "START", 7)]           // grblHAL
    [InlineData("[MSG:TOOL_CHANGE_COMPLETE7]", "COMPLETE", 7)]      // spaces stripped
    [InlineData("[MSG:INFO: MSG, TOOL_CHANGE_START 12]", "START", 12)] // FluidNC
    [InlineData("[MSG:TOOL_CHANGE_COMPLETE]", "COMPLETE", 0)]       // no id
    public void Sentinel_echo_is_read_from_either_controller(string line, string kind, int id)
    {
        Assert.True(ToolChangeSentinel.TryParse(line, out var k, out var i));
        Assert.Equal(kind, k);
        Assert.Equal(id, i);
    }

    [Fact]
    public void Complete_waits_for_motion_and_is_a_cleanup_line()
    {
        Assert.Equal("G4 P0", ToolChangeSentinel.Sync().Command);
        Assert.False(ToolChangeSentinel.Sync().Cleanup);
        Assert.True(ToolChangeSentinel.Complete(3).Cleanup);
        Assert.Equal("(MSG, TOOL_CHANGE_COMPLETE 3)", ToolChangeSentinel.Complete(3).Command);
    }

    private ToolChangeEvent? _lastEnd;

    private bool? InDoubtAfter(params string[] sentLines)
    {
        var id = Register();
        Echo($"[MSG:TOOL_CHANGE_START {id}]");
        foreach (var line in sentLines) Ack(line, "success");
        _controller.Raise(c => c.StopReceived += null);
        return _lastEnd?.LengthInDoubt;
    }

    [Fact]
    public void An_abort_at_the_tool_sensor_check_leaves_the_length_alone()
        => Assert.False(InDoubtAfter("G53 G0 Z0", "(DONGLE:XIO:OUT 0 1)", "(DONGLE_WAIT:XIO:IN1=1:0:0.5:ELSE)",
            "(MSG, TOOL_CHANGE_START 4)", "(G43.1 is applied after the sensor check)", "M66 P0 L3 Q1", "M65 P2", "M0"));

    [Theory]
    [InlineData("G43.1 Z0")]
    [InlineData("G43.1 Z0.000")]
    [InlineData("g49")]
    [InlineData("G38.2 G91 Z-15 F200")]
    [InlineData("$TLS")]
    [InlineData("M6 T3")]
    [InlineData("G65 P101")]
    public void A_line_that_clears_or_measures_the_length_puts_it_in_doubt(string line)
        => Assert.True(InDoubtAfter("G53 G0 Z0", line));

    [Fact]
    public void A_rejected_probe_counts_too()
    {
        var id = Register();
        Echo($"[MSG:TOOL_CHANGE_START {id}]");
        Ack("G38.3 G91 Z-15.000 F99999", "error");
        Assert.True(_lastEnd?.LengthInDoubt);
    }

    // Library strategy: the stored length was applied, then the exit leg was
    // stopped. The offset is right for the tool in the spindle.
    [Fact]
    public void Applying_a_stored_length_settles_it()
        => Assert.False(InDoubtAfter("G43.1 Z0", "G43.1 Z-48.695", "G53 G0 X63.8 Y-863.231"));

    // Measure strategy: the measurement finished and was applied.
    [Fact]
    public void Applying_a_finished_measurement_settles_it()
        => Assert.False(InDoubtAfter("G43.1 Z0", "G38.2 G91 Z-15 F200", "G43.1 Z[#<_NC_LAST_TLO>]"));

    // sylthecru: stopped while measuring the newly loaded tool.
    [Fact]
    public void Stopping_mid_measurement_leaves_it_in_doubt()
        => Assert.True(InDoubtAfter("G43.1 Z-30.1", "G43.1 Z0", "G38.2 G91 Z-15 F200"));

    [Fact]
    public void Each_change_starts_with_no_doubt()
    {
        Assert.True(InDoubtAfter("G43.1 Z0"));
        Assert.False(InDoubtAfter("G53 G0 Z0"));
    }
}

// The hooks reach a loaded JS plugin with the event fields the issue asked for.
public class ToolChangePluginHookTests
{
    [Fact]
    public async Task Plugin_receives_start_and_end_with_outcome()
    {
        var controller = new Mock<ICncController>();
        var tracker = new ToolChangeTracker(controller.Object, NullLogger<ToolChangeTracker>.Instance);
        var engine = new NcSender.Server.Plugins.JsPluginEngine(
            NullLogger<NcSender.Server.Plugins.JsPluginEngine>.Instance,
            new NcSender.Server.Plugins.PluginDialogDispatcher(new Mock<IBroadcaster>().Object, NullLogger<NcSender.Server.Plugins.PluginDialogDispatcher>.Instance),
            new Mock<IGateService>().Object, new Mock<IToolService>().Object, new Mock<IDongleDeviceService>().Object,
            new Mock<NcSender.Server.Tools.IPendingToolTloWriteback>().Object, new Mock<IServerContext>().Object,
            new Mock<IFirmwareService>().Object, controller.Object, new Mock<IServiceProvider>().Object, tracker);

        var dir = Directory.CreateTempSubdirectory();
        var file = Path.Combine(dir.FullName, "commands.js");
        File.WriteAllText(file, """
            var seen = [];
            function onToolChangeStart(e) { seen.push('start ' + e.kind + ' T' + e.tool + ' from T' + e.previousTool + ' ' + e.sourceId + ' ' + e.jobRunning); }
            function onToolChangeEnd(e) { seen.push('end ' + e.outcome + ' ' + e.reason); }
            function onBeforeCommand(c) { return c; }
            function buildInitialConfig(raw) { return raw; }
            export { onBeforeCommand, onToolChangeStart, onToolChangeEnd };
            """);
        engine.LoadPlugin("test.toolchange", file, new());

        var ok = tracker.Register(new ToolChangeInfo("M6", 5, 2, "M6 T5", "client", false));
        controller.Raise(c => c.DataReceived += null, $"[MSG:TOOL_CHANGE_START {ok}]", (string?)null);
        controller.Raise(c => c.DataReceived += null, $"[MSG:TOOL_CHANGE_COMPLETE {ok}]", (string?)null);
        var bad = tracker.Register(new ToolChangeInfo("TLS", 5, 5, "$TLS", "client", false));
        controller.Raise(c => c.DataReceived += null, $"[MSG:TOOL_CHANGE_START {bad}]", (string?)null);
        controller.Raise(c => c.StopReceived += null);
        await engine.ToolChangeHooksIdle;

        var seen = engine.EvaluateForTest("test.toolchange", "seen.join('|')");
        Assert.Equal("start M6 T5 from T2 client false|end completed null|start TLS T5 from T5 client false|end aborted stopped", seen);
        dir.Delete(true);
    }
}
