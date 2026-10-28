using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

// An output command over the radio is confirmed by the device's "$OK out n v";
// one that is never answered (a lost ESP-NOW packet) is sent again, so a
// drawbar release can't silently do nothing.
public class DongleOutputRetryTests
{
    private static (DongleDeviceService svc, List<string> sent) NewService(Action<DongleDeviceService, string>? onSend = null)
    {
        var bc = new Mock<IBroadcaster>();
        bc.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<System.Text.Json.JsonElement>())).Returns(Task.CompletedTask);
        var svc = new DongleDeviceService(NullLogger<DongleDeviceService>.Instance, bc.Object) { OutputAckTimeoutMs = 40 };
        var sent = new List<string>();
        svc.SetSender(line =>
        {
            lock (sent) sent.Add(line);
            onSend?.Invoke(svc, line);
            return Task.CompletedTask;
        });
        return (svc, sent);
    }

    [Fact]
    public async Task Confirmed_IsSentOnce()
    {
        var (svc, sent) = NewService((s, line) => s.OnDongleLine("@xio $OK out 0 1"));
        await svc.SendAsync("xio", "out 0 1");
        Assert.Single(sent);
    }

    [Fact]
    public async Task LostPacket_IsSentAgain()
    {
        var n = 0;
        // The first send is lost; the second is answered.
        var (svc, sent) = NewService((s, line) => { if (++n == 2) s.OnDongleLine("@xio $OK out 0 1"); });
        await svc.SendAsync("xio", "out 0 1");
        Assert.Equal(new[] { "@xio out 0 1", "@xio out 0 1" }, sent);
    }

    [Fact]
    public async Task NeverAnswered_GivesUpAfterThreeSends()
    {
        var (svc, sent) = NewService();
        await svc.SendAsync("xio", "out 0 1");
        Assert.Equal(3, sent.Count);
    }

    [Fact]
    public async Task RefusedByTheDevice_IsNotSentAgain()
    {
        var (svc, sent) = NewService((s, line) => s.OnDongleLine("@xio $ERR:SPINDLE"));
        await svc.SendAsync("xio", "out 0 1");
        Assert.Single(sent);
    }

    [Fact]
    public async Task ANewerCommand_StopsTheOldRetries()
    {
        var (svc, sent) = NewService((s, line) => { if (line.EndsWith("0 0")) s.OnDongleLine("@xio $OK out 0 0"); });
        var release = svc.SendAsync("xio", "out 0 1");   // never answered
        await svc.SendAsync("xio", "out 0 0");           // clamp, answered
        await release;
        Assert.Equal(new[] { "@xio out 0 1", "@xio out 0 0" }, sent);
    }

    [Fact]
    public async Task OtherCommands_AreSentOnceAsBefore()
    {
        var (svc, sent) = NewService();
        await svc.SendAsync("xio", "status");
        await svc.SendAsync("autodustboot", "goto:0");
        Assert.Equal(new[] { "@xio status", "@autodustboot goto:0" }, sent);
    }
}
