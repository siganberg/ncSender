using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

/// <summary>
/// (MSG, NCSENDER_PAUSE: Title | Body) lets an operator raise their own dialog
/// from any event field, macro or g-code file, paired with an M0 the same way
/// the plugin fault dialogs are. These cover the wire format and the split,
/// which is all of it that can get the text wrong.
/// </summary>
public class CncEventBridgePauseTests
{
    private static string Extract(string controllerLine)
    {
        var m = CncEventBridge.PauseMessageRegex.Match(controllerLine);
        Assert.True(m.Success, $"regex did not match: {controllerLine}");
        return m.Groups[1].Value;
    }

    [Theory]
    // grblHAL echoes a (MSG,...) comment back in these shapes.
    [InlineData("[MSG:NCSENDER_PAUSE: Dust shoe | Fit it, then Continue]")]
    [InlineData("[MSG,NCSENDER_PAUSE: Dust shoe | Fit it, then Continue]")]
    [InlineData("[MSG: NCSENDER_PAUSE : Dust shoe | Fit it, then Continue]")]
    [InlineData("[msg:ncsender_pause: Dust shoe | Fit it, then Continue]")]
    public void RecognisesTheShapesTheControllerEchoes(string line)
    {
        var (title, body) = CncEventBridge.ParsePauseMessage(Extract(line));
        Assert.Equal("Dust shoe", title);
        Assert.Equal("Fit it, then Continue", body);
    }

    [Fact]
    public void NoSeparatorMakesTheWholeThingTheBody()
    {
        var (title, body) = CncEventBridge.ParsePauseMessage(" Fit the dust shoe ");
        Assert.Equal("Paused", title);
        Assert.Equal("Fit the dust shoe", body);
    }

    [Fact]
    public void AnEmptyMessageStillGetsUsableWording()
    {
        var (title, body) = CncEventBridge.ParsePauseMessage("");
        Assert.Equal("Paused", title);
        Assert.False(string.IsNullOrWhiteSpace(body));
    }

    [Fact]
    public void AnEmptyHalfFallsBackWithoutSwallowingTheOther()
    {
        var (t1, b1) = CncEventBridge.ParsePauseMessage("Dust shoe |");
        Assert.Equal("Dust shoe", t1);
        Assert.False(string.IsNullOrWhiteSpace(b1));

        var (t2, b2) = CncEventBridge.ParsePauseMessage("| Fit it");
        Assert.Equal("Paused", t2);
        Assert.Equal("Fit it", b2);
    }

    [Fact]
    public void OnlyTheFirstSeparatorSplits()
    {
        var (title, body) = CncEventBridge.ParsePauseMessage("Tool | check A | then B");
        Assert.Equal("Tool", title);
        Assert.Equal("check A | then B", body);
    }

    // The text is whatever the operator typed into a settings field. It is
    // handed to the dialog as plain text, so markup in it must survive as
    // characters rather than being interpreted or stripped.
    [Fact]
    public void OperatorTextIsCarriedThroughUntouched()
    {
        var (_, body) = CncEventBridge.ParsePauseMessage("Check clearance < 5mm & retry");
        Assert.Equal("Check clearance < 5mm & retry", body);
    }

    [Fact]
    public void APlainPluginMessageIsNotMistakenForAPause()
    {
        Assert.False(CncEventBridge.PauseMessageRegex
            .IsMatch("[MSG:PLUGIN_PNEUMATICATC:DRAWBAR_FAILED_TO_OPEN]"));
    }

    // The operator's capitalisation has to reach the dialog. ncSender upper-cases
    // outgoing g-code before it hits the wire -- correct for g-code, wrong for a
    // sentence someone typed -- and grblHAL echoes back exactly what it was
    // given, so anything upper-cased on the way out comes back shouting.
    [Fact]
    public void MixedCaseSurvivesTheSplit()
    {
        var (title, body) = CncEventBridge.ParsePauseMessage("Dust shoe | Fit the dust shoe, then click Continue");
        Assert.Equal("Dust shoe", title);
        Assert.Equal("Fit the dust shoe, then click Continue", body);
        Assert.NotEqual(body, body.ToUpperInvariant());
    }
}
