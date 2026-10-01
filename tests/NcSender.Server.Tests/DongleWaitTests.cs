using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

public class DongleWaitTests
{
    private static DongleDeviceService NewService() =>
        new(NullLogger<DongleDeviceService>.Instance, new Mock<IBroadcaster>().Object);

    [Fact]
    public void Parse_ValidSentinel()
    {
        var w = DongleWait.TryParse("(DONGLE_WAIT:autodustboot:pos=46524:50:5)");
        Assert.NotNull(w);
        Assert.Equal(new DongleWait("autodustboot", "pos", 46524, 50, 5000), w);
    }

    [Fact]
    public void Parse_NegativeTargetAndFractionalTimeout()
    {
        var w = DongleWait.TryParse("(DONGLE_WAIT:dev:pos=-3:10:1.5)");
        Assert.Equal(new DongleWait("dev", "pos", -3, 10, 1500), w);
    }

    [Theory]
    [InlineData("(DONGLE:autodustboot:goto:0)")]
    [InlineData("(DONGLE_WAIT:autodustboot:pos=0:50)")]
    [InlineData("(DONGLE_WAIT:autodustboot:pos:50:5)")]
    [InlineData("(DONGLE_WAIT:autodustboot:pos=x:50:5)")]
    [InlineData("(DONGLE_WAIT:autodustboot:pos=0:50:0)")]
    [InlineData("G4 P1.5")]
    public void Parse_RejectsOtherLines(string line) => Assert.Null(DongleWait.TryParse(line));

    [Fact]
    public void Parse_CapsTimeout() =>
        Assert.Equal(30000, DongleWait.TryParse("(DONGLE_WAIT:d:pos=0:5:600)")!.TimeoutMs);

    [Fact]
    public void PauseLine_OpensTheOperatorPauseDialogAndHolds()
    {
        var line = DongleWait.TryParse("(DONGLE_WAIT:autodustboot:pos=0:50:5)")!.PauseLine();
        Assert.StartsWith("(MSG, NCSENDER_PAUSE: Dust boot not responding | ", line);
        Assert.EndsWith(")M0", line);
        // One comment, no nested parentheses (g-code comments cannot hold them),
        // and well inside grblHAL's ~256 character line limit.
        Assert.Equal(1, line.Count(c => c == '('));
        Assert.Equal(1, line.Count(c => c == ')'));
        Assert.True(line.Length < 240, $"{line.Length} chars");
        var (title, body) = CncEventBridge.ParsePauseMessage(
            line["(MSG, NCSENDER_PAUSE:".Length..line.LastIndexOf(')')]);
        Assert.Equal("Dust boot not responding", title);
        Assert.Contains("Abort", body);
    }

    [Fact]
    public void DisplayName_FallsBackToTheDeviceName() =>
        Assert.Equal("ncprobe", DongleWait.TryParse("(DONGLE_WAIT:ncprobe:state=1:0:2)")!.DisplayName);

    [Theory]
    [InlineData("status pos=-3 expand=46524 state=home", "pos", -3)]
    [InlineData("status pos=12 expand=46524", "expand", 46524)]
    public void ReadField(string line, string field, long expected)
    {
        Assert.True(DongleDeviceService.TryReadField(line, field, out var v));
        Assert.Equal(expected, v);
    }

    [Fact]
    public void ReadField_WholeTokenOnly() =>
        Assert.False(DongleDeviceService.TryReadField("status xpos=5", "pos", out _));

    [Fact]
    public async Task Wait_AlreadyAtTarget_ReturnsAtOnce()
    {
        var svc = NewService();
        svc.OnDongleLine("@autodustboot status pos=-3 expand=46524 state=home");
        var r = await svc.WaitForValueAsync("autodustboot", "pos", 0, 50, 5000);
        Assert.Equal(DongleWaitResult.AlreadyThere, r);
    }

    [Fact]
    public async Task Wait_Moving_ReturnsWhenArrivedStatusLands()
    {
        var svc = NewService();
        svc.OnDongleLine("@autodustboot status pos=46524 expand=46524 state=expanded");
        var wait = svc.WaitForValueAsync("autodustboot", "pos", 0, 50, 5000);
        await Task.Delay(50);
        Assert.False(wait.IsCompleted);
        svc.OnDongleLine("@autodustboot status pos=46524 expand=46524 state=expanded"); // heartbeat, not there yet
        Assert.False(wait.IsCompleted);
        svc.OnDongleLine("@autodustboot status pos=2 expand=46524 state=home");
        Assert.Equal(DongleWaitResult.Arrived, await wait);
    }

    [Fact]
    public async Task Wait_NeverArrives_TimesOut()
    {
        var svc = NewService();
        svc.OnDongleLine("@autodustboot status pos=46524 expand=46524");
        var r = await svc.WaitForValueAsync("autodustboot", "pos", 0, 50, 200);
        Assert.Equal(DongleWaitResult.TimedOut, r);
    }

    [Fact]
    public async Task Wait_UnknownDevice_IsOffline()
    {
        var r = await NewService().WaitForValueAsync("autodustboot", "pos", 0, 50, 5000);
        Assert.Equal(DongleWaitResult.Offline, r);
    }

    [Fact]
    public async Task Wait_Cancelled_Throws()
    {
        var svc = NewService();
        svc.OnDongleLine("@autodustboot status pos=46524");
        using var cts = new CancellationTokenSource(100);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => svc.WaitForValueAsync("autodustboot", "pos", 0, 50, 5000, cts.Token));
    }
}
