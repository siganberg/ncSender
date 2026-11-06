using NcSender.Server.GcodeFiles;

namespace NcSender.Server.Tests;

public class GCodePreAnalyzerTests
{
    private static GCodePreAnalyzer Analyzer() => new(
        rapidMmPerMin: 5000,
        vmaxMmPerMin: (5000, 5000, 1000),
        accelMmPerSec2: (500, 500, 200),
        junctionDeviationMm: 0.01);

    private const string Program = "G21 G90\nG0 X0 Y0\nG1 X100 F1200\n(comment)\nG1 Y50\nG2 X150 Y0 I0 J-50\nM5\n";

    [Fact]
    public void AnalyzeLines_IsIndexedLikeTheProgramLines()
    {
        var sec = Analyzer().AnalyzeLines(Program);
        Assert.Equal(Program.Split('\n').Length, sec.Length);
        Assert.Equal(0, sec[0]);   // G21 G90
        Assert.Equal(0, sec[3]);   // comment
        Assert.Equal(0, sec[6]);   // M5
        Assert.True(sec[2] > 0 && sec[4] > 0 && sec[5] > 0);
    }

    [Fact]
    public void AnalyzeLines_AddsUpToTheTotal()
    {
        var a = Analyzer();
        Assert.Equal(a.Analyze(Program), a.AnalyzeLines(Program).Sum(), 9);
    }

    [Fact]
    public void AStraightFeedTakesAboutDistanceOverFeed()
    {
        // 100 mm at 20 mm/s: 5 s plus a little for accelerating.
        var sec = Analyzer().AnalyzeLines("G1 X100 F1200\n");
        Assert.InRange(sec[0], 5.0, 5.2);
    }

    [Fact]
    public void EmptyProgram_HasNoLines()
    {
        Assert.Empty(Analyzer().AnalyzeLines(""));
        Assert.Equal(0, Analyzer().Analyze(""));
    }
}
