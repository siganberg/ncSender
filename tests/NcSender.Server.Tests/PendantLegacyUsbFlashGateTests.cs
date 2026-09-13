using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

/// <summary>
/// Pendant firmware speaks the "$OTA:BEGIN" protocol on USB from v1.0.31.
/// Anything older on a cable must go through the pendant manager's original
/// wired flasher; the version gate decides that.
/// </summary>
public class PendantLegacyUsbFlashGateTests
{
    [Theory]
    [InlineData("1.0.16", true)]
    [InlineData("v1.0.30", true)]
    [InlineData("1.0.20-beta.2", true)]
    [InlineData("0.9.99", true)]
    [InlineData("1.0.31", false)]
    [InlineData("1.0.34", false)]
    [InlineData("1.1.0", false)]
    [InlineData("2.0.0", false)]
    public void GateFollowsTheUsbBeginProtocolVersion(string version, bool expectLegacy)
    {
        Assert.Equal(expectLegacy, DongleOtaService.PendantNeedsLegacyUsbFlash(version));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("dev")]
    [InlineData("1.0")]
    public void UnknownVersionsNeverBlockTheNormalPath(string? version)
    {
        Assert.False(DongleOtaService.PendantNeedsLegacyUsbFlash(version));
    }
}
