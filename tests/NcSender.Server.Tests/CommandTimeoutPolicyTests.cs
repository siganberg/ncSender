using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

public class CommandTimeoutPolicyTests
{
    // The policy is intentionally minimal: a flat 1s on manual commands so a
    // genuine controller choke surfaces fast. Long-running ops (homing,
    // motion, spindle ramp, dwell) are paced by the controller itself; jobs
    // and macros bypass the timeout via the source-id whitelist in
    // CncController.

    [Theory]
    [InlineData("$J=G91 X10 F1000")]
    [InlineData("M3 S1000")]
    [InlineData("M5")]
    [InlineData("$H")]
    [InlineData("G0 X10")]
    [InlineData("G1 X10 F500")]
    [InlineData("G4 P0.5")]
    [InlineData("G38.2 Z-10 F100")]
    [InlineData("M0")]
    [InlineData("M6 T3")]
    [InlineData("$$")]
    [InlineData("$X")]
    [InlineData("")]
    public void EveryCommand_GetsOneSecond(string command)
    {
        Assert.Equal(TimeSpan.FromSeconds(1), CommandTimeoutPolicy.GetTimeout(command));
    }
}
