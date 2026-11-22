using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

// A soft reset puts grblHAL back in G54. When that drops the offset the
// operator was using (G55..G59) in the middle of a connection, it's offered
// back, once; anything else stays quiet.
public class WorkOffsetAfterResetTests
{
    private static readonly DateTime T0 = new(2026, 11, 22, 11, 3, 43, DateTimeKind.Utc);

    private static WorkOffsetAfterReset Running()
    {
        var w = new WorkOffsetAfterReset();
        w.Connected();
        w.Confirmed();
        return w;
    }

    [Fact]
    public void AResetFromG55ToG54IsOfferedBackOnce()
    {
        var w = Running();
        w.Reset("G55", T0);
        // Until $G comes back the old offset is still shown: nothing yet.
        Assert.Null(w.Changed("G55", T0.AddMilliseconds(50)));
        Assert.Equal("G55", w.Changed("G54", T0.AddMilliseconds(120)));
        Assert.Null(w.Changed("G54", T0.AddMilliseconds(200)));
    }

    [Theory]
    [InlineData("G56")]
    [InlineData("G59")]
    public void AnyOffsetAfterG54IsOfferedBack(string was)
    {
        var w = Running();
        w.Reset(was, T0);
        Assert.Equal(was, w.Changed("G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AlreadyInG54NothingToOffer()
    {
        var w = Running();
        w.Reset("G54", T0);
        Assert.Null(w.Changed("G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AFreshConnectionHasNoBefore()
    {
        var w = new WorkOffsetAfterReset();
        w.Connected();
        w.Reset("G55", T0);   // the reset on connecting, before any $G reply
        Assert.Null(w.Changed("G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AReconnectForgetsTheOldOne()
    {
        var w = Running();
        w.Reset("G55", T0);
        w.Connected();
        Assert.Null(w.Changed("G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AStartupBlockPickingAnotherOffsetIsTheOperatorsChoice()
    {
        var w = Running();
        w.Reset("G55", T0);
        Assert.Null(w.Changed("G57", T0.AddSeconds(1)));
    }

    [Fact]
    public void AChangeLongAfterTheResetIsNotTheResets()
    {
        var w = Running();
        w.Reset("G55", T0);
        Assert.Null(w.Changed("G54", T0 + WorkOffsetAfterReset.Window + TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void NotAWorkOffsetNoOffer()
    {
        var w = Running();
        w.Reset(null, T0);
        Assert.Null(w.Changed("G54", T0.AddSeconds(1)));
        w.Reset("G59.1", T0);
        Assert.Null(w.Changed("G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AStopThenTheGreetingCountsOnceWithTheOffsetBeforeBoth()
    {
        var w = Running();
        w.Reset("G55", T0);                       // ncSender's 0x18
        w.Reset("G54", T0.AddMilliseconds(300));  // the greeting, after a report already said G54
        Assert.Equal("G55", w.Changed("G54", T0.AddMilliseconds(400)));
    }

    [Fact]
    public void ANetworkedControllerWithNoGreetingStillCounts()
    {
        var w = Running();
        w.Reset("G55", T0);   // Stop, and no greeting follows
        Assert.Equal("G55", w.Changed("G54", T0.AddSeconds(1.5)));   // the $G a moment later
    }
}
