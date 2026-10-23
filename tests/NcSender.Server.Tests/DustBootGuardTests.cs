using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

public class DustBootGuardTests
{
    [Theory]
    [InlineData("goto:39950", true)]
    [InlineData("down", true)]
    [InlineData("stepdown", true)]
    [InlineData("goto:0", false)]
    [InlineData("goto:100", false)]   // within 0.3 mm of home
    [InlineData("up", false)]
    [InlineData("stepup", false)]
    [InlineData("stop", false)]
    [InlineData("home", false)]
    [InlineData("status", false)]
    public void Expand_IsRefusedOnlyDuringAToolChange(string payload, bool expands)
    {
        Assert.Equal(expands, DustBootGuard.Blocks("autodustboot", payload, toolChanging: true));
        Assert.False(DustBootGuard.Blocks("autodustboot", payload, toolChanging: false));
    }

    [Fact]
    public void OtherDevices_AreNeverRefused() =>
        Assert.False(DustBootGuard.Blocks("xio", "goto:39950", toolChanging: true));
}
