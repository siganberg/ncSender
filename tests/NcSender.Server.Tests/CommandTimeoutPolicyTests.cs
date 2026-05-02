using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

// Per-command response timeouts prevent the queue from getting stuck when the
// controller drops or delays an "ok" ack. Without this, a single missed ack
// leaves every subsequent command spinning forever, and the only escape is a
// soft-reset via the Stop button. The policy buckets each command so genuinely
// long ops (homing, M0 holds, dwell) keep their generous wait, while the
// hot-path commands (jogs, queries, modes) fail fast.
public class CommandTimeoutPolicyTests
{
    [Theory]
    [InlineData("M0")]
    [InlineData("M00")]
    [InlineData("M1")]
    [InlineData("M01")]
    [InlineData("M001")]
    [InlineData("M6")]
    [InlineData("M06")]
    [InlineData("M6 T3")]
    [InlineData("m0")]
    [InlineData("  M0  ")]
    public void Indefinite_HoldsUntilUserAction(string command)
    {
        Assert.Null(CommandTimeoutPolicy.GetTimeout(command));
    }

    [Theory]
    [InlineData("$H")]
    [InlineData("$HX")]
    [InlineData("$HY")]
    [InlineData("$HZ")]
    [InlineData("G28")]
    [InlineData("G30")]
    [InlineData("G28 X0 Y0")]
    [InlineData("G028")]
    public void LongMechanical_GetsFiveMinutes(string command)
    {
        var timeout = CommandTimeoutPolicy.GetTimeout(command);
        Assert.Equal(TimeSpan.FromMinutes(5), timeout);
    }

    [Theory]
    [InlineData("G38.2 Z-50 F100")]
    [InlineData("G38.3 X-25 F500")]
    [InlineData("G38.4 Z5 F50")]
    [InlineData("G38.5 X1 F50")]
    public void Probing_GetsSixtySeconds(string command)
    {
        var timeout = CommandTimeoutPolicy.GetTimeout(command);
        Assert.Equal(TimeSpan.FromSeconds(60), timeout);
    }

    [Theory]
    [InlineData("G4 P0.5", 0.5)]
    [InlineData("G4 P1", 1.0)]
    [InlineData("G4 P10", 10.0)]
    [InlineData("G04 P2.5", 2.5)]
    [InlineData("g4 p0.2", 0.2)]
    public void Dwell_ParsesPValuePlusBuffer(string command, double expectedSeconds)
    {
        var timeout = CommandTimeoutPolicy.GetTimeout(command);
        Assert.NotNull(timeout);
        Assert.Equal(expectedSeconds + 2, timeout.Value.TotalSeconds, precision: 3);
    }

    [Theory]
    [InlineData("G0 X10")]
    [InlineData("G1 X10 Y20 F500")]
    [InlineData("G2 X1 Y1 I0.5 J0")]
    [InlineData("G3 X0 Y0 I-1 J0")]
    [InlineData("G00 X100")]
    [InlineData("G01 X10 F100")]
    public void Motion_GetsTenSeconds(string command)
    {
        var timeout = CommandTimeoutPolicy.GetTimeout(command);
        Assert.Equal(TimeSpan.FromSeconds(10), timeout);
    }

    [Theory]
    [InlineData("$J=G91 X10 F1000")]
    [InlineData("$J=G91 Y-1 F500")]
    [InlineData("$J=G53 G90 X100 Y100 F2000")]
    public void Jog_GetsOneSecond(string command)
    {
        var timeout = CommandTimeoutPolicy.GetTimeout(command);
        Assert.Equal(TimeSpan.FromSeconds(1), timeout);
    }

    [Theory]
    [InlineData("$$")]
    [InlineData("$G")]
    [InlineData("$#")]
    [InlineData("$I")]
    [InlineData("$X")]
    [InlineData("$A")]
    [InlineData("$EA")]
    [InlineData("$EE")]
    [InlineData("$pinstate")]
    [InlineData("M3 S1000")]
    [InlineData("M4 S500")]
    [InlineData("M5")]
    [InlineData("M7")]
    [InlineData("M8")]
    [InlineData("M9")]
    [InlineData("M61 Q3")]
    [InlineData("G20")]
    [InlineData("G21")]
    [InlineData("G90")]
    [InlineData("G91")]
    [InlineData("G93")]
    [InlineData("G94")]
    [InlineData("G54")]
    [InlineData("G59")]
    [InlineData("G10 L20 X0")]
    [InlineData("G92 X0 Y0")]
    [InlineData("$RST=*")]
    public void Default_GetsOneSecond(string command)
    {
        var timeout = CommandTimeoutPolicy.GetTimeout(command);
        Assert.Equal(TimeSpan.FromSeconds(1), timeout);
    }

    [Fact]
    public void EmptyCommand_GetsDefaultTimeout()
    {
        Assert.Equal(TimeSpan.FromSeconds(1), CommandTimeoutPolicy.GetTimeout(""));
    }
}
