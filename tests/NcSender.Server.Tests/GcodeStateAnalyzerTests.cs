using NcSender.Core.Models;
using NcSender.Server.GcodeAnalysis;

namespace NcSender.Server.Tests;

public class GcodeStateAnalyzerTests
{
    private readonly GcodeStateAnalyzer _analyzer = new();

    [Fact]
    public void AnalyzeToLine_EmptyContent_ReturnsDefaultState()
    {
        var state = _analyzer.AnalyzeToLine("", 1);
        Assert.Equal("G0", state.MotionMode);
        Assert.Equal("G21", state.Units);
        Assert.Equal("G17", state.Plane);
        Assert.Equal("M5", state.SpindleState);
        Assert.Equal("G54", state.Wcs);
        Assert.Equal("G90", state.PositioningMode);
        Assert.Equal(0, state.Tool);
    }

    [Fact]
    public void AnalyzeToLine_TracksToolChange()
    {
        var content = "G21\nT5 M6\nG0 X10 Y20";
        var state = _analyzer.AnalyzeToLine(content, 3);
        Assert.Equal(5, state.Tool);
    }

    [Fact]
    public void AnalyzeToLine_TracksFeedRate()
    {
        var content = "G1 X10 F500\nG1 Y20 F1000";
        var state = _analyzer.AnalyzeToLine(content, 2);
        Assert.Equal(1000, state.FeedRate);
    }

    [Fact]
    public void AnalyzeToLine_TracksSpindleState()
    {
        var content = "M3 S12000\nG0 X10\nM5";

        var state2 = _analyzer.AnalyzeToLine(content, 2);
        Assert.Equal("M3", state2.SpindleState);
        Assert.Equal(12000, state2.SpindleSpeed);

        var state3 = _analyzer.AnalyzeToLine(content, 3);
        Assert.Equal("M5", state3.SpindleState);
    }

    [Fact]
    public void AnalyzeToLine_TracksCoolant()
    {
        var content = "M8\nG0 X10\nM7\nG0 Y20\nM9";

        var state3 = _analyzer.AnalyzeToLine(content, 3);
        Assert.True(state3.CoolantFlood);
        Assert.True(state3.CoolantMist);

        var state5 = _analyzer.AnalyzeToLine(content, 5);
        Assert.False(state5.CoolantFlood);
        Assert.False(state5.CoolantMist);
    }

    [Fact]
    public void AnalyzeToLine_TracksWCS()
    {
        var content = "G54\nG0 X10\nG55\nG0 Y20";
        var state = _analyzer.AnalyzeToLine(content, 4);
        Assert.Equal("G55", state.Wcs);
    }

    [Fact]
    public void AnalyzeToLine_TracksUnits()
    {
        var content = "G20\nG0 X1 Y2";
        var state = _analyzer.AnalyzeToLine(content, 2);
        Assert.Equal("G20", state.Units);
    }

    [Fact]
    public void AnalyzeToLine_TracksPlane()
    {
        var content = "G18\nG0 X10";
        var state = _analyzer.AnalyzeToLine(content, 2);
        Assert.Equal("G18", state.Plane);
    }

    [Fact]
    public void AnalyzeToLine_TracksPosition()
    {
        var content = "G90\nG0 X10 Y20 Z-5";
        var state = _analyzer.AnalyzeToLine(content, 2);
        Assert.Equal(10, state.PositionX);
        Assert.Equal(20, state.PositionY);
        Assert.Equal(-5, state.PositionZ);
    }

    [Fact]
    public void AnalyzeToLine_TracksIncrementalPosition()
    {
        var content = "G91\nG0 X10 Y20\nG0 X5 Y-10";
        var state = _analyzer.AnalyzeToLine(content, 3);
        Assert.Equal(15, state.PositionX);
        Assert.Equal(10, state.PositionY);
    }

    [Fact]
    public void AnalyzeToLine_TracksMotionMode()
    {
        var content = "G0 X10\nG1 Y20 F100\nG2 X30 Y30 I5 J5";
        var state = _analyzer.AnalyzeToLine(content, 3);
        Assert.Equal("G2", state.MotionMode);
    }

    [Fact]
    public void AnalyzeToLine_TracksAuxOutputs()
    {
        var content = "M64 P0\nM64 P1\nG0 X10\nM65 P0";
        var state = _analyzer.AnalyzeToLine(content, 4);
        Assert.False(state.AuxOutputs[0]);
        Assert.True(state.AuxOutputs[1]);
    }

    [Fact]
    public void AnalyzeToLine_IgnoresComments()
    {
        var content = "; This is a comment\nG0 X10 (inline comment) Y20\n; Another comment\nG1 Z-5 F200";
        var state = _analyzer.AnalyzeToLine(content, 4);
        Assert.Equal(10, state.PositionX);
        Assert.Equal(20, state.PositionY);
        Assert.Equal(-5, state.PositionZ);
    }

    [Fact]
    public void AnalyzeToLine_StopsAtTargetLine()
    {
        var content = "G0 X10\nG0 X20\nG0 X30";
        var state = _analyzer.AnalyzeToLine(content, 2);
        Assert.Equal(20, state.PositionX);
    }

    [Fact]
    public void FindArcStart_NoArcParams_ReturnsNull()
    {
        var lines = new[] { "G0 X10 Y20", "G1 X30 Y40 F100" };
        var result = _analyzer.FindArcStart(lines, 2);
        Assert.Null(result);
    }

    [Fact]
    public void FindArcStart_ArcWithG2_ReturnsNull()
    {
        var lines = new[] { "G0 X10 Y20", "G2 X30 Y40 I5 J5" };
        var result = _analyzer.FindArcStart(lines, 2);
        Assert.Null(result);
    }

    [Fact]
    public void FindArcStart_ArcWithoutG2_FindsStart()
    {
        var lines = new[] { "G0 X10 Y20", "G2 X30 Y40 I5 J5", "X50 Y60 I10 J10" };
        var result = _analyzer.FindArcStart(lines, 3);
        Assert.Equal(2, result);
    }

    [Fact]
    public void GenerateResumeSequence_BasicState()
    {
        var state = new GcodeState
        {
            Tool = 3,
            Units = "G21",
            Plane = "G17",
            Wcs = "G54",
            PositioningMode = "G90",
            MotionMode = "G1",
            PositionX = 50,
            PositionY = 100,
            PositionZ = -10,
            FeedRate = 500,
            SpindleState = "M3",
            SpindleSpeed = 12000
        };

        var options = new StartFromLineRequest
        {
            StartLine = 100,
            SpindleDelaySec = 3,
            ApproachHeight = 5,
            PlungeFeedRate = 100
        };

        var sequence = _analyzer.GenerateResumeSequence(state, options);

        Assert.Contains("(Resume sequence for starting from line)", sequence);
        Assert.Contains("G53 G0 Z-5.000", sequence);
        Assert.Contains("M6 T3", sequence);
        Assert.Contains("G21", sequence);
        Assert.Contains("G17", sequence);
        Assert.Contains("G54", sequence);
        Assert.Contains("G90", sequence);
        Assert.Contains("S12000", sequence);
        Assert.Contains("M3", sequence);
        Assert.Contains("G4 P3.0", sequence);
        Assert.Contains("(End resume sequence)", sequence);
        // Verify XY move comes before Z approach
        var xyIdx = sequence.FindIndex(s => s.StartsWith("G0 X"));
        var zIdx = sequence.FindIndex(s => s.StartsWith("G0 Z"));
        Assert.True(xyIdx < zIdx);
    }

    [Fact]
    public void GenerateResumeSequence_NoCoolant_NoMCodes()
    {
        var state = new GcodeState
        {
            SpindleState = "M5",
            CoolantFlood = false,
            CoolantMist = false
        };

        var options = new StartFromLineRequest { ApproachHeight = 5, PlungeFeedRate = 100 };
        var sequence = _analyzer.GenerateResumeSequence(state, options);

        Assert.DoesNotContain("M7", sequence);
        Assert.DoesNotContain("M8", sequence);
    }

    [Fact]
    public void ParseWords_BasicGcode()
    {
        var words = GcodeStateAnalyzer.ParseWords("G0 X10.5 Y-20.3 Z0.1");
        Assert.Equal(4, words.Count);
        Assert.Equal('G', words[0].Letter);
        Assert.Equal(0, words[0].Value);
        Assert.Equal('X', words[1].Letter);
        Assert.Equal(10.5, words[1].Value);
        Assert.Equal('Y', words[2].Letter);
        Assert.Equal(-20.3, words[2].Value);
    }

    [Fact]
    public void ParseWords_StripsNNumber()
    {
        var words = GcodeStateAnalyzer.ParseWords("N100 G1 X10 F500");
        Assert.Equal(3, words.Count);
        Assert.Equal('G', words[0].Letter);
    }
}
