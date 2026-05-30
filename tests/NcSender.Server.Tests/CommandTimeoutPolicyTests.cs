using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

public class CommandTimeoutPolicyTests
{
    // The policy itself is a flat 1s for any input — the WHEN is decided in
    // CncController, which only applies this timeout to jog commands ($J=...)
    // so a stuck jog UX surfaces fast. Long-running ops (spindle ramp, homing,
    // motion, dwell, jobs, macros) bypass the policy entirely and wait as long
    // as the controller takes.

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
