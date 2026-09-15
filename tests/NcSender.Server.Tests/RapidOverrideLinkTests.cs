using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

public class RapidOverrideLinkTests
{
    [Theory]
    [InlineData(200, 100)]
    [InlineData(100, 100)]
    [InlineData(51, 100)]
    [InlineData(50, 50)]
    [InlineData(26, 50)]
    [InlineData(25, 25)]
    [InlineData(20, 25)]
    [InlineData(11, 25)]
    [InlineData(10, 5)]
    [InlineData(1, 5)]
    public void RapidLevelForFeed_UsesSmallestLevelAtOrAboveFeed(double feedOverride, int expected)
    {
        Assert.Equal(expected, CncEventBridge.RapidLevelForFeed(feedOverride));
    }

    [Theory]
    [InlineData(100, "\x95")]
    [InlineData(50, "\x96")]
    [InlineData(25, "\x97")]
    [InlineData(5, "\x98")]
    public void RapidOverrideCommand_MapsLevelToRealtimeByte(int level, string expected)
    {
        Assert.Equal(expected, CncEventBridge.RapidOverrideCommand(level));
    }

    [Theory]
    [InlineData(100, 90, 100, null)]
    [InlineData(100, 50, 100, "\x96")]
    [InlineData(50, 20, 50, "\x97")]
    [InlineData(20, 10, 25, "\x98")]
    [InlineData(20, 100, 25, "\x95")]
    [InlineData(40, 30, 50, null)]
    [InlineData(60, 60, 25, null)]
    public void RapidCommandForFeedChange_OnlyWhenFeedChangesAndLevelDiffers(double previousFeed, double feed, double rapid, string? expected)
    {
        Assert.Equal(expected, CncEventBridge.RapidCommandForFeedChange(previousFeed, feed, rapid));
    }
}
