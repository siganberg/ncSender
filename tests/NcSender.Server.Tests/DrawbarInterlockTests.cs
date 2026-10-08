using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

// An Wireless I/O output that drives the drawbar must never switch on
// while the spindle turns. The bridge reports which outputs are drawbars
// ("dr=<hex>" in its status) and enforces it itself; the host refuses the
// same releases from every path as a second layer.
public class DrawbarInterlockTests
{
    private readonly DongleDeviceService _svc;
    private readonly List<string> _radio = [];
    private readonly List<(string Type, string Json)> _broadcasts = [];
    private bool _spindle;

    public DrawbarInterlockTests()
    {
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<System.Text.Json.JsonElement>()))
            .Callback<string, System.Text.Json.JsonElement>((t, e) => { lock (_broadcasts) _broadcasts.Add((t, e.GetRawText())); })
            .Returns(Task.CompletedTask);
        _svc = new DongleDeviceService(NullLogger<DongleDeviceService>.Instance, broadcaster.Object);
        _svc.SetSender(line => { _radio.Add(line); return Task.CompletedTask; });
        _svc.SpindleActive = () => _spindle;
        // OUT1 (out 0) is the drawbar.
        _svc.OnDongleLine("@xio status in=00 out=0 lo=0 fs=1 dr=1 lk=0 in0=0 in1=1 out0=0 seq=5");
    }

    [Theory]
    [InlineData("out 0 1")]
    [InlineData("pulse 0 500")]
    public async Task A_drawbar_release_is_refused_while_the_spindle_turns(string payload)
    {
        _spindle = true;
        await _svc.SendAsync("xio", payload);
        Assert.Empty(_radio);
    }

    [Theory]
    [InlineData("out 0 0")]      // clamping is always allowed
    [InlineData("out 1 1")]      // not a drawbar output
    [InlineData("failsafe 0 1")]
    public async Task Everything_else_still_goes_through_with_the_spindle_on(string payload)
    {
        _spindle = true;
        await _svc.SendAsync("xio", payload);
        Assert.Equal([$"@xio {payload}"], _radio);
    }

    [Fact]
    public async Task With_the_spindle_stopped_the_drawbar_releases()
    {
        await _svc.SendAsync("xio", "out 0 1");
        Assert.Equal(["@xio out 0 1"], _radio);
    }

    [Fact]
    public async Task A_device_that_reports_no_drawbar_outputs_is_never_refused()
    {
        _spindle = true;
        _svc.OnDongleLine("@autodustboot status pos=0 seq=1");
        await _svc.SendAsync("autodustboot", "out 0 1");
        Assert.Equal(["@autodustboot out 0 1"], _radio);
    }

    [Fact]
    public void Command_replies_do_not_replace_the_status_a_sensor_check_reads()
    {
        _svc.OnDongleLine("@xio $OK role 0 drawbar");
        _svc.OnDongleLine("@xio $ERR:SPINDLE");
        Assert.Contains("in1=1", _svc.GetDevice("xio")!.LastMessage);
    }

    [Fact]
    public async Task The_shared_DRO_goes_down_the_cable_only_to_devices_that_read_it()
    {
        var bridge = new List<string>();
        var dustBoot = new List<string>();
        _svc.SetWiredSender("xio", l => { bridge.Add(l); return Task.CompletedTask; });
        _svc.SetWiredSender("autodustboot", l => { dustBoot.Add(l); return Task.CompletedTask; });
        _svc.OnDongleLine("@autodustboot status pos=0 seq=1");

        Assert.True(_svc.HasWiredDroSubscribers);
        await _svc.SendDroToWiredAsync("$Idle|R:0");
        Assert.Equal(["$Idle|R:0"], bridge);
        Assert.Empty(dustBoot);
    }

    [Fact]
    public void Firmware_without_the_interlock_gets_no_DRO_on_its_cable()
    {
        var svc = new DongleDeviceService(NullLogger<DongleDeviceService>.Instance, new Mock<IBroadcaster>().Object);
        svc.SetWiredSender("xio", _ => Task.CompletedTask);
        svc.OnDongleLine("@xio status in=00 out=0 lo=0 fs=1 in0=0 seq=1");   // no dr=
        Assert.False(svc.HasWiredDroSubscribers);
    }

    private List<string> DrawbarPopups()
    {
        lock (_broadcasts)
            return _broadcasts.Where(b => b.Type == "plugin:show-modal" && b.Json.Contains("drawbar-blocked")).Select(b => b.Json).ToList();
    }

    [Fact]
    public async Task A_refused_release_raises_the_drawbar_popup()
    {
        _spindle = true;
        await _svc.SendAsync("xio", "out 0 1");
        var popup = Assert.Single(DrawbarPopups());
        Assert.Contains("Drawbar Release Blocked", popup);
        Assert.Contains("out 0 1", popup);
    }

    [Fact]
    public async Task No_popup_when_nothing_was_refused()
    {
        await _svc.SendAsync("xio", "out 0 1");      // spindle stopped
        _spindle = true;
        await _svc.SendAsync("xio", "out 0 0");      // clamping is never refused
        Assert.Empty(DrawbarPopups());
    }

    [Fact]
    public void The_bridge_refusing_it_itself_raises_the_popup_too()
    {
        _svc.OnDongleLine("@xio $ERR:SPINDLE");
        Assert.Single(DrawbarPopups());
    }
}
