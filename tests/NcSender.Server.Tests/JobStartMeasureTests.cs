using NcSender.Server.Job;

namespace NcSender.Server.Tests;

// Job start measures the loaded tool when there is no tool length reference,
// unless the program changes to another tool before it moves (that change
// measures anyway).
public class JobStartMeasureTests
{
    private static bool Skip(int current, params string[] lines) =>
        JobManager.FirstToolChangeLoadsAnotherTool(lines, current);

    [Fact]
    public void ChangeToAnotherToolFirst_SkipsTheExtraMeasure()
    {
        Assert.True(Skip(1, "G21 G90", "T2 M6", "G0 X0 Y0"));
        Assert.True(Skip(1, "(Tool 2)", "T2", "M6", "G0 X0 Y0"));
        Assert.True(Skip(1, "N10 G17 G21", "N20 M06 T02", "N30 G0 Z5"));
    }

    [Fact]
    public void SameToolOrMotionFirst_MeasuresTheLoadedTool()
    {
        Assert.False(Skip(1, "T1 M6", "G0 X0 Y0"));        // M6 to the tool already in: no measure there
        Assert.False(Skip(1, "G0 Z5", "T2 M6"));           // moves with T1 before the change
        Assert.False(Skip(1, "G21", "X10 Y10", "T2 M6"));  // bare modal move counts as motion
        Assert.False(Skip(1, "G21 G90 G54", "M3 S12000")); // no tool change at all
        Assert.False(Skip(1, "M6"));                       // M6 without a T word: unknown tool
    }

    [Fact]
    public void CommentsAndNonMotionGCodesAreIgnored()
    {
        Assert.True(Skip(1, "(G0 X0 is in a comment)", "; G1 Z-1", "G28 G30 G38.2 G10 L20 Z0", "T3 M6"));
        Assert.True(Skip(1, "G20 G21 G17 G90", "M6 T2"));
    }
}
