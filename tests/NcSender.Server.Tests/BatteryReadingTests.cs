using NcSender.Server.Dongle;

namespace NcSender.Server.Tests;

public class BatteryReadingTests
{
    [Theory]
    [InlineData("0:H:1234:B3648:P", "3648")]
    [InlineData("0:H:216:BU:P", "U")]
    [InlineData("0:H:40:BC3954:P", "C3954")]
    [InlineData("0:H:216:P", null)]
    [InlineData("state=idle pos=1", null)]
    public void Token_IsTheSecondToLastField(string payload, string? expected) =>
        Assert.Equal(expected, BatteryReading.Token(payload));

    [Fact]
    public void NoBField_ShowsNothing()
    {
        var b = new BatteryReading();
        b.Observe("0:H:1:P", 0);
        Assert.Null(b.Millivolts);
        Assert.False(b.OnUsb);
    }

    [Fact]
    public void OneNoisySample_DoesNotMoveTheLevel()
    {
        var b = new BatteryReading();
        long t = 0;
        foreach (var mv in new[] { 3650, 3648, 3130, 3652 })
        {
            b.Observe($"0:H:1:B{mv}:P", t);
            t += 30_000;
        }
        Assert.Equal(3649, b.Millivolts);
    }

    [Fact]
    public void RepeatedHeartbeats_CountAsOneSample()
    {
        var b = new BatteryReading();
        for (var i = 0; i < 10; i++) b.Observe("0:H:1:B3130:P", i * 200);
        b.Observe("0:H:1:B3650:P", 30_000);
        b.Observe("0:H:1:B3652:P", 60_000);
        Assert.Equal(3650, b.Millivolts);
    }

    [Fact]
    public void Usb_ReportsChargingAndDropsTheLevel()
    {
        var b = new BatteryReading();
        b.Observe("0:H:1:B3700:P", 0);
        b.Observe("0:H:2:BU:P", 1000);
        Assert.True(b.OnUsb);
        Assert.Null(b.Millivolts);
        b.Observe("0:H:3:B4150:P", 2000);
        Assert.False(b.OnUsb);
        Assert.Equal(4150, b.Millivolts);
    }

    [Fact]
    public void Charging_KeepsItsOwnMedian()
    {
        var b = new BatteryReading();
        b.Observe("0:H:1:BC4050:P", 0);
        b.Observe("0:H:2:BC4060:P", 30_000);
        Assert.True(b.Charging);
        Assert.Equal(4055, b.Millivolts);
        // Unplugged: the inflated charging readings must not pull the level up.
        b.Observe("0:H:3:B3880:P", 31_000);
        Assert.False(b.Charging);
        Assert.Equal(3880, b.Millivolts);
    }

    [Theory]
    [InlineData(4250, 100)]
    [InlineData(4200, 100)]
    [InlineData(3800, 50)]
    [InlineData(3648, 20)]
    [InlineData(3300, 0)]
    [InlineData(3000, 0)]
    public void Percent_FollowsTheLipoCurve(int mv, int percent) =>
        Assert.Equal(percent, BatteryReading.Percent(mv));
}
