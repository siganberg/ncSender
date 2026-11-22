using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

// A soft reset puts grblHAL back in G54. When that drops the offset the
// operator was using (G55..G59) in the middle of a connection, it's offered
// back, once; anything else stays quiet.
public class WorkOffsetAfterResetTests
{
    private static readonly DateTime T0 = new(2026, 11, 22, 11, 3, 43, DateTimeKind.Utc);

    // The offset offered back, or null.
    private static string? W(WorkOffsetAfterReset w, string? workspace, DateTime now) => w.Changed(workspace, now)?.Was;

    private static WorkOffsetAfterReset Running()
    {
        var w = new WorkOffsetAfterReset();
        w.Connected();
        w.Confirmed("G55");
        return w;
    }

    [Fact]
    public void AResetFromG55ToG54IsOfferedBackOnce()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");
        // Until $G comes back the old offset is still shown: nothing yet.
        Assert.Null(W(w, "G55", T0.AddMilliseconds(50)));
        Assert.Equal("G55", W(w, "G54", T0.AddMilliseconds(120)));
        Assert.Null(W(w, "G54", T0.AddMilliseconds(200)));
    }

    [Theory]
    [InlineData("G56")]
    [InlineData("G59")]
    public void AnyOffsetAfterG54IsOfferedBack(string was)
    {
        var w = Running();
        w.Dropped(was, T0, "reset");
        Assert.Equal(was, W(w, "G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AlreadyInG54NothingToOffer()
    {
        var w = Running();
        w.Dropped("G54", T0, "reset");
        Assert.Null(W(w, "G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AFreshConnectionHasNoBefore()
    {
        var w = new WorkOffsetAfterReset();
        w.Connected();
        w.Dropped("G55", T0, "reset");   // the reset on connecting, before any $G reply
        Assert.Null(W(w, "G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AReconnectForgetsTheOldOne()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");
        w.Connected();
        Assert.Null(W(w, "G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AStartupBlockPickingAnotherOffsetIsTheOperatorsChoice()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");
        Assert.Null(W(w, "G57", T0.AddSeconds(1)));
    }

    [Fact]
    public void AChangeLongAfterTheResetIsNotTheResets()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");
        Assert.Null(W(w, "G54", T0 + WorkOffsetAfterReset.Window + TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void NotAWorkOffsetNoOffer()
    {
        var w = Running();
        w.Dropped(null, T0, "reset");
        Assert.Null(W(w, "G54", T0.AddSeconds(1)));
        w.Dropped("G59.1", T0, "reset");
        Assert.Null(W(w, "G54", T0.AddSeconds(1)));
    }

    [Fact]
    public void AStopThenTheGreetingCountsOnceWithTheOffsetBeforeBoth()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");                       // ncSender's 0x18
        w.Dropped("G54", T0.AddMilliseconds(300), "reset");  // the greeting, after a report already said G54
        Assert.Equal("G55", W(w, "G54", T0.AddMilliseconds(400)));
    }

    [Fact]
    public void ANetworkedControllerWithNoGreetingStillCounts()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");   // Stop, and no greeting follows
        Assert.Equal("G55", W(w, "G54", T0.AddSeconds(1.5)));   // the $G a moment later
    }

    [Fact]
    public void AProgramEndFromG55IsOfferedBackWithItsReason()
    {
        var w = Running();
        w.Dropped("G55", T0, "The program's end (M2/M30) put the controller back in");
        var d = w.Changed("G54", T0.AddMilliseconds(10));
        Assert.Equal("G55", d?.Was);
        Assert.Equal("The program's end (M2/M30) put the controller back in", d?.Why);
    }

    [Fact]
    public void AnotherEventAfterTheWindowWatchesAgain()
    {
        var w = Running();
        Assert.True(w.Dropped("G55", T0, "reset"));
        Assert.Null(W(w, "G54", T0 + WorkOffsetAfterReset.Window + TimeSpan.FromSeconds(1)));
        Assert.True(w.Dropped("G56", T0.AddSeconds(30), "reset"));
        Assert.Equal("G56", W(w, "G54", T0.AddSeconds(31)));
    }

    [Fact]
    public void NotWatchingSaysSo()
    {
        var w = Running();
        Assert.False(w.Dropped("G54", T0, "reset"));
        Assert.True(w.Dropped("G55", T0, "reset"));
        Assert.False(w.Dropped("G55", T0.AddMilliseconds(200), "reset"));   // the same reset's greeting
    }

    [Fact]
    public void NoOffsetReportedYetIsNotAChange()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");
        Assert.Null(W(w, null, T0.AddMilliseconds(50)));
        Assert.Equal("G55", W(w, "G54", T0.AddMilliseconds(100)));
    }

    // grblHAL set to keep the offset at M30 (or a startup block): the $G
    // after the program's end still says G55, so a G54 picked later is the
    // operator's own, not the program end's.
    [Fact]
    public void AGReplyStillInTheOldOffsetEndsIt()
    {
        var w = Running();
        w.Dropped("G55", T0, "program end");
        w.Confirmed("G55");
        Assert.Null(W(w, "G54", T0.AddSeconds(3)));
    }

    [Fact]
    public void AGReplyInG54DoesNotEndIt()
    {
        var w = Running();
        w.Dropped("G55", T0, "reset");
        w.Confirmed("G54");
        Assert.Equal("G55", W(w, "G54", T0.AddSeconds(2)));
    }

    [Theory]
    [InlineData("[MSG:Pgm End]", true)]
    [InlineData("  [MSG:Pgm End]\r", true)]
    [InlineData("[MSG:INFO: Program End]", true)]
    [InlineData("[MSG:Pgm End reached in a comment]", false)]
    [InlineData("[MSG:Note Pgm End]", false)]
    [InlineData("ok", false)]
    public void ProgramEndMessages(string line, bool end) => Assert.Equal(end, WorkOffsetAfterReset.IsProgramEnd(line));

    [Theory]
    [InlineData("[GC:G0 G55 G17 G21 G90 G94 M5 M9 T0 F0 S0]", "G55")]
    [InlineData("[GC:G1 G54 G17 G20 G91 G94 M3 M9 T2 F500 S12000]", "G54")]
    [InlineData("[GC:G0 G59.1 G17 G21 G90]", null)]
    [InlineData("[GC:G0 G17 G21 G90]", null)]
    public void TheOffsetInAGReply(string reply, string? offset) => Assert.Equal(offset, WorkOffsetAfterReset.WorkOffsetIn(reply));
}
