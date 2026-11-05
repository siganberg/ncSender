using NcSender.Core.Models;
using NcSender.Server.Job;

namespace NcSender.Server.Tests;

public class JobCompletedLineTests
{
    [Fact]
    public void ACompletedJobEndsOnTheLastLine()
    {
        var job = new JobInfo { Status = "running", TotalLines = 2003, SentLine = 2003, CurrentLine = 1980, ProgressPercent = 98.85 };
        JobManager.MarkCompleted(job);
        Assert.Equal("completed", job.Status);
        Assert.Equal(2003, job.CurrentLine);
        Assert.Equal(100, job.ProgressPercent);
        Assert.NotNull(job.JobEndTime);
    }
}
