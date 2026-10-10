using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

/// <summary>
/// Continue on a plugin or pause dialog sends one cycle start. A second one
/// only follows when the door was opened during the pause; sending it every
/// time released the program's next M0 when it came within 500 ms (manual
/// tool change: "unload probe" then "install T1" with no move between).
/// </summary>
public class GateContinueTests
{
    [Theory]
    // A plain M0 pause: the first ~ releases it. Whatever the status is by the
    // time the second would go, it must not be sent: "Hold" here is the NEXT M0.
    [InlineData("Hold", "Hold")]
    [InlineData("Hold", "Run")]
    [InlineData("Hold", "Idle")]
    [InlineData("Hold:0", "Hold:0")]
    // Status not known yet: no second ~.
    [InlineData(null, "Hold")]
    [InlineData("", "Hold")]
    [InlineData("Unknown", "Hold")]
    public void PlainPauseGetsOneCycleStart(string? atContinue, string? now)
    {
        Assert.False(CncEventBridge.NeedsSecondCycleStart(atContinue, now));
    }

    [Theory]
    // Door stacked on the M0: the first ~ only drops back to the M0 Hold.
    [InlineData("Door", "Hold")]
    [InlineData("Door:0", "Hold:0")]
    [InlineData("Door:0", "Door:0")]
    [InlineData("door", "hold")]
    public void DoorOnTopOfThePauseGetsTheSecondCycleStart(string atContinue, string now)
    {
        Assert.True(CncEventBridge.NeedsSecondCycleStart(atContinue, now));
    }

    [Theory]
    // Door case, but the first ~ already got the program going: leave it alone.
    [InlineData("Door:0", "Run")]
    [InlineData("Door:0", "Idle")]
    [InlineData("Door:0", "Alarm")]
    [InlineData("Door:0", null)]
    public void DoorCaseSkipsTheSecondOnceTheMachineIsMoving(string atContinue, string? now)
    {
        Assert.False(CncEventBridge.NeedsSecondCycleStart(atContinue, now));
    }
}
