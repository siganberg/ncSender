namespace NcSender.Core.Models;

public class GcodeState
{
    public int Tool { get; set; }
    public string MotionMode { get; set; } = "G0";
    public string Units { get; set; } = "G21";
    public string Plane { get; set; } = "G17";
    public double FeedRate { get; set; }
    public string SpindleState { get; set; } = "M5";
    public double SpindleSpeed { get; set; }
    public bool CoolantFlood { get; set; }
    public bool CoolantMist { get; set; }
    public string Wcs { get; set; } = "G54";
    public string PositioningMode { get; set; } = "G90";
    public double PositionX { get; set; }
    public double PositionY { get; set; }
    public double PositionZ { get; set; }
    public Dictionary<int, bool> AuxOutputs { get; set; } = new();
}

public class AnalyzeLineRequest
{
    // V1 client sends "lineNumber"
    public int LineNumber { get; set; }
}

public class AnalyzeLineResponse
{
    public GcodeState State { get; set; } = new();
    public List<string> ResumeSequence { get; set; } = [];
    public bool ToolMismatch { get; set; }
    public int CurrentTool { get; set; }
    public int TargetTool { get; set; }
    public int LineNumber { get; set; }
    public int? OriginalLineNumber { get; set; }
    public bool LineAdjusted { get; set; }
    public int TotalLines { get; set; }
    public List<string> Warnings { get; set; } = [];
}

public class StartFromLineRequest
{
    // V1 client sends "startLine"
    public int StartLine { get; set; }
    public string? Filename { get; set; }
    public bool SkipToolCheck { get; set; }
    public double SpindleDelaySec { get; set; } = 3;
    public double ApproachHeight { get; set; } = 5;
    public double PlungeFeedRate { get; set; } = 100;
    public double SafeZHeight { get; set; } = -5;
    public bool TargetLineIsRapid { get; set; }
}

public class StartFromLineResponse
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public string? Message { get; set; }
    public List<string> ResumeSequence { get; set; } = [];
    public int StartLine { get; set; }
    public int? OriginalStartLine { get; set; }
    public bool LineAdjusted { get; set; }
}
