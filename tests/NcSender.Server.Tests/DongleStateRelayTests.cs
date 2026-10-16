using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

// Device messages reach the UI throttled to ~1/s, but a change of the
// device's state= token is relayed at once, so a quick toggle following the
// dust boot never misses where a move ended.
public class DongleStateRelayTests
{
    private static (DongleDeviceService svc, List<string> sent) NewService()
    {
        var sent = new List<string>();
        var bc = new Mock<IBroadcaster>();
        bc.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<System.Text.Json.JsonElement>()))
          .Callback<string, System.Text.Json.JsonElement>((type, data) =>
          {
              if (type == "dongle:device-message") sent.Add(data.GetProperty("payload").GetString()!);
          })
          .Returns(Task.CompletedTask);
        return (new DongleDeviceService(NullLogger<DongleDeviceService>.Instance, bc.Object), sent);
    }

    [Theory]
    [InlineData("status pos=-3 expand=46524 state=home", "home")]
    [InlineData("state=moving pos=100", "moving")]
    [InlineData("out0=1 out1=0", null)]
    public void StateToken_ReadsTheStateField(string payload, string? expected) =>
        Assert.Equal(expected, DongleDeviceService.StateToken(payload));

    [Fact]
    public void StateChange_IsRelayedInsideTheThrottleWindow()
    {
        var (svc, sent) = NewService();
        svc.OnDongleLine("@autodustboot status pos=0 expand=46524 state=home");      // connect edge
        svc.OnDongleLine("@autodustboot status pos=100 expand=46524 state=moving");  // state change
        svc.OnDongleLine("@autodustboot status pos=900 expand=46524 state=moving");  // same state: throttled
        svc.OnDongleLine("@autodustboot status pos=46524 expand=46524 state=expanded"); // state change
        Assert.Equal(new[] {
            "status pos=0 expand=46524 state=home",
            "status pos=100 expand=46524 state=moving",
            "status pos=46524 expand=46524 state=expanded" }, sent);
    }

    [Fact]
    public void NoStateField_StaysThrottled()
    {
        var (svc, sent) = NewService();
        svc.OnDongleLine("@xio out0=1");
        svc.OnDongleLine("@xio out0=0");
        Assert.Single(sent);
    }
}
