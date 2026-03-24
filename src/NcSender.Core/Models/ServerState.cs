namespace NcSender.Core.Models;

public class ServerState
{
    public MachineState MachineState { get; set; } = new();
    public string SenderStatus { get; set; } = "setup-required";
    public string? GreetingMessage { get; set; }
    public JobInfo? JobLoaded { get; set; }
    public bool DisplayFirmware { get; set; } = true;
    public bool DisplayConfig { get; set; }
}

public class JobInfo
{
    public string Filename { get; set; } = "";
    public int CurrentLine { get; set; }
    public int TotalLines { get; set; }
    public string? Status { get; set; } // running, paused, completed
    public DateTime? JobStartTime { get; set; }
    public DateTime? JobEndTime { get; set; }
    public DateTime? JobPauseAt { get; set; }
    public double JobPausedTotalSec { get; set; }
    public double ProgressPercent { get; set; }
    public double RuntimeSec { get; set; }
    public double? RemainingSec { get; set; }
    public string? ProgressProvider { get; set; }
    public double? ActualElapsedSec { get; set; }
    public DateTime? LoadedAt { get; set; }
    public bool IsTemporary { get; set; }
    public string? SourceFile { get; set; }
    public double? EstimatedSec { get; set; }
}
