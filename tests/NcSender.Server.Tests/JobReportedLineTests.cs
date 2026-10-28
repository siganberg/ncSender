using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

public class JobReportedLineTests
{
    [Fact]
    public void ALineLeftOverFromThePreviousRunIsIgnored()
    {
        var job = new JobInfo { TotalLines = 750, SentLine = 3 };
        CncEventBridge.TakeReportedLine(job, 500);
        Assert.Equal(0, job.CurrentLine);
        Assert.Equal(0, job.ProgressPercent);
    }

    [Fact]
    public void ALineAlreadySentIsTaken()
    {
        var job = new JobInfo { TotalLines = 100, SentLine = 40 };
        CncEventBridge.TakeReportedLine(job, 25);
        Assert.Equal(25, job.CurrentLine);
        Assert.Equal(25, job.ProgressPercent);
    }

    [Fact]
    public void NoLineNumberLeavesProgressAlone()
    {
        var job = new JobInfo { TotalLines = 100, SentLine = 40, CurrentLine = 12 };
        CncEventBridge.TakeReportedLine(job, 0);
        Assert.Equal(12, job.CurrentLine);
    }
}
