namespace NcSender.Core.Models;

public class CommandProcessorContext
{
    public string? CommandId { get; set; }
    public CommandMeta? Meta { get; set; }
    public MachineState MachineState { get; set; } = new();
    public int LineNumber { get; set; }
    public string? Filename { get; set; }

    /// <summary>
    /// Next XY position from G-code file (set by job runner for return-to-position after M6).
    /// When set, uses work coordinates instead of machine coordinates for return.
    /// </summary>
    public XyPosition? NextXYPosition { get; set; }

    /// <summary>
    /// Safe Z height in machine coordinates (from core app settings).
    /// Plugins should use this for retraction instead of hardcoded G53 Z0.
    /// </summary>
    public double SafeZHeight { get; set; }

    /// <summary>
    /// Tool number expected to be in the spindle when this line executes, as
    /// resolved by IToolProjection. Set by PluginCommandProcessor so plugins
    /// see execution-time tool state instead of MachineState.Tool, which is
    /// stale for every line of a batch that was expanded ahead of execution.
    /// Null when no projection was supplied (falls back to MachineState.Tool).
    /// </summary>
    public int? ProjectedTool { get; set; }
}

public class XyPosition
{
    public double X { get; set; }
    public double Y { get; set; }
}

public class CommandProcessorResult
{
    public bool ShouldContinue { get; set; } = true;
    public List<ProcessedCommand> Commands { get; set; } = [];
    public string? Error { get; set; }
    public string? SkipReason { get; set; }
}

public class ProcessedCommand
{
    public string Command { get; set; } = "";
    public string? DisplayCommand { get; set; }
    public bool IsOriginal { get; set; } = true;
    public CommandMeta? Meta { get; set; }
}
