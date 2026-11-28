using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

/// <summary>
/// The Wireless I/O reports raw input states and has no polarity setting, so
/// "Invert" is kept in ncSender and applied to what the board reports.
/// </summary>
public class InputInvertTests
{
    [Theory]
    // Status: the hex mask and each in<n> field flip for the inverted inputs only.
    [InlineData("status in=00 out=0 vin=24100 in0=0 in1=0 in2=0 in3=0 out0=0 seq=7", 0b0101,
        "status in=05 out=0 vin=24100 in0=1 in1=0 in2=1 in3=0 out0=0 seq=7")]
    [InlineData("status in=0f in0=1 in1=1 in2=1 in3=1", 0b0010, "status in=0d in0=1 in1=0 in2=1 in3=1")]
    // Event: the reported value flips along with its field.
    [InlineData("in 2 1 in0=0 in1=0 in2=1 in3=0 out0=0 seq=8", 0b0100, "in 2 0 in0=0 in1=0 in2=0 in3=0 out0=0 seq=8")]
    // An event for an input that is not inverted keeps its value.
    [InlineData("in 1 1 in0=0 in1=1", 0b0001, "in 1 1 in0=1 in1=1")]
    // Nothing inverted, and lines that are not state, pass through.
    [InlineData("status in=00 in0=0", 0, "status in=00 in0=0")]
    [InlineData("$OK out 0 1", 0b1111, "$OK out 0 1")]
    [InlineData("$VERSION:0.1.5", 0b1111, "$VERSION:0.1.5")]
    public void Inverted_inputs_flip_in_what_the_board_reports(string payload, int mask, string expected)
    {
        Assert.Equal(expected, InputInvert.Apply(payload, mask));
    }

    [Fact]
    public void Outputs_and_other_fields_are_never_touched()
    {
        var line = InputInvert.Apply("status in=00 out=3 out0=1 out1=1 info=1 in0=0", 0b1);
        Assert.Contains(" out=3 out0=1 out1=1 info=1 ", line);
    }

    [Fact]
    public void The_inputs_a_status_reports_are_read_in_order()
    {
        Assert.Equal(new[] { false, true, false, true }, InputInvert.ReadStates("status in=0a in0=0 in1=1 in2=0 in3=1 out0=0"));
        Assert.Null(InputInvert.ReadStates("status pos=0 state=home"));
        Assert.Null(InputInvert.ReadStates(null));
    }

    // Everything that reads the device (plugins, DONGLE_WAIT, the Accessories
    // view) goes through the stored status, so that is where it must show.
    [Fact]
    public async Task The_stored_status_and_a_sensor_wait_see_the_inverted_state()
    {
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);
        using var svc = new DongleDeviceService(NullLogger<DongleDeviceService>.Instance, broadcaster.Object)
        {
            InputInvertMask = name => name == "xio" ? 0b01 : 0,
        };

        svc.OnDongleLine("@xio status in=00 in0=0 in1=0 out0=0");
        svc.OnDongleLine("@autodustboot status in0=0 pos=0");

        Assert.Equal("status in=01 in0=1 in1=0 out0=0", svc.GetDevice("xio")!.LastMessage);
        Assert.Equal("status in0=0 pos=0", svc.GetDevice("autodustboot")!.LastMessage);
        Assert.Equal(DongleWaitResult.AlreadyThere, await svc.WaitForValueAsync("xio", "in0", 1, 0, 200, CancellationToken.None));
    }
}
