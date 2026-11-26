using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Server.Dongle;
using NcSender.Server.Usb;

namespace NcSender.Server.Tests;

/// <summary>
/// A cabled Wireless I/O tags what it reports ("@xio status …"), the same
/// line it puts on the radio. The USB link only took lines starting with
/// "status", so the board's state never arrived: it was missing from the
/// device list, and it never got the machine-state feed, without which it
/// refuses to open a drawbar output.
/// </summary>
public class UsbAccessoryStateTests
{
    [Theory]
    [InlineData("xio", "@xio status in=00 out=0 lo=0 fs=1 vin=24100 up=12 in0=0 out0=0 out1=0 dr=1 lk=1 wp=4 seq=7",
        "status in=00 out=0 lo=0 fs=1 vin=24100 up=12 in0=0 out0=0 out1=0 dr=1 lk=1 wp=4 seq=7")]
    [InlineData("xio", "@xio in 2 1 in0=0 in1=0 in2=1 in3=0 out0=0 seq=8", "in 2 1 in0=0 in1=0 in2=1 in3=0 out0=0 seq=8")]
    [InlineData("xio", "@XIO status out=1", "status out=1")]
    [InlineData("autodustboot", "status pos=0 expand=34388 state=home homed=1", "status pos=0 expand=34388 state=home homed=1")]
    public void What_a_device_reports_is_taken_with_or_without_its_tag(string peer, string line, string expected)
    {
        Assert.Equal(expected, UsbAccessoryLink.ReportedState(peer, line));
    }

    [Theory]
    [InlineData("xio", "$OK out 1 1")]
    [InlineData("xio", "$ERR:SPINDLE")]
    [InlineData("xio", "$VERSION:0.1.5")]
    [InlineData("xio", "=== ncSender xIO 0.1.5 ===")]
    [InlineData("xio", "@autodustboot status pos=0")]
    [InlineData("xio", "@xio $OK role 1 none")]
    [InlineData("xio", "statusline")]
    public void Answers_and_chatter_are_not_state(string peer, string line)
    {
        Assert.Null(UsbAccessoryLink.ReportedState(peer, line));
    }

    // A board on a cable that was never paired to a Wireless USB: it was not
    // in the device list at all, so Edit Output and the tool changer's
    // drawbar picker did not offer its outputs, and its state never showed.

    private static DongleDeviceService Service()
    {
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        return new DongleDeviceService(NullLogger<DongleDeviceService>.Instance, broadcaster.Object);
    }

    [Fact]
    public void A_cabled_board_is_a_known_device_as_soon_as_its_link_opens()
    {
        using var svc = Service();
        Assert.Null(svc.GetDevice("xio"));

        svc.SetWiredSender("xio", _ => Task.CompletedTask);

        var device = svc.GetDevice("xio");
        Assert.NotNull(device);
        Assert.Equal("usb", device!.Transport);
        Assert.False(device.Connected);   // nothing heard from it yet
    }

    [Fact]
    public void Its_state_arrives_once_it_answers_and_it_shows_connected()
    {
        using var svc = Service();
        svc.SetWiredSender("xio", _ => Task.CompletedTask);
        svc.OnWiredLine("xio", UsbAccessoryLink.ReportedState("xio", "@xio status in=00 out=2 out0=0 out1=1 dr=1 lk=0 wp=0 seq=3")!);

        var device = svc.GetDevice("xio")!;
        Assert.True(device.Connected);
        Assert.Contains("out1=1", device.LastMessage);
        Assert.True(svc.HasWiredDroSubscribers);   // it now gets the machine-state feed
    }

    [Fact]
    public void A_wireless_usb_that_never_paired_it_does_not_remove_it()
    {
        using var svc = Service();
        svc.SetWiredSender("xio", _ => Task.CompletedTask);
        svc.OnDongleLine("@old status pos=0");

        svc.BeginEnumeration();
        svc.OnDongleLine("$DEVICES:autodustboot");
        svc.OnDongleLine("$DEVICES:END");

        var names = svc.GetDevices().Select(d => d.Name).OrderBy(n => n).ToArray();
        Assert.Equal(new[] { "autodustboot", "xio" }, names);
    }

    [Fact]
    public void Unplugged_it_goes_back_to_what_the_radio_says()
    {
        using var svc = Service();
        svc.SetWiredSender("xio", _ => Task.CompletedTask);
        svc.SetWiredSender("xio", null);

        svc.BeginEnumeration();
        svc.OnDongleLine("$DEVICES:END");
        Assert.Null(svc.GetDevice("xio"));
    }

    [Theory]
    [InlineData("xio", 0, 10_000, true)]        // never reported
    [InlineData("xio", 6_000, 10_000, true)]    // quiet for 4 s
    [InlineData("xio", 8_500, 10_000, false)]   // reported 1.5 s ago
    [InlineData("autodustboot", 0, 10_000, false)]   // reports on its own
    public void A_quiet_wireless_io_is_asked_for_its_state(string peer, long last, long now, bool ask)
    {
        Assert.Equal(ask, UsbAccessoryLink.NeedsStatePoll(peer, last, now));
    }
}
