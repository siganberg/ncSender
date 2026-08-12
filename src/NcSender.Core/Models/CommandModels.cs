using System.Text.Json.Serialization;

namespace NcSender.Core.Models;

public class CommandOptions
{
    public string? CommandId { get; set; }
    public string? DisplayCommand { get; set; }
    public CommandMeta? Meta { get; set; }
}

/// <summary>
/// Per-command noise control. Every flag defaults to false, i.e. everything is
/// shown and logged unless the sender explicitly opts out — the two channels
/// (operator terminal, server log) and the two directions (the command we send,
/// the controller output it produces) are independent, so a caller can e.g.
/// keep an internal $I query out of the terminal while still recording it in
/// the log for support.
/// </summary>
public class CommandQuiet
{
    /// <summary>Hide the command itself from the terminal.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool TerminalCommand { get; set; }

    /// <summary>Hide the controller output this command produces from the terminal.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool TerminalResponse { get; set; }

    /// <summary>Keep the command out of the server log (including the API request line).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool LogCommand { get; set; }

    /// <summary>Keep the controller output this command produces out of the server log.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool LogResponse { get; set; }
}

public class CommandMeta
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SourceId { get; set; }

    /// <summary>
    /// Legacy shorthand: hides the command and its result from the terminal.
    /// Kept as-is for existing callers; <see cref="Quiet"/> is additive on top.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Silent { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public CommandQuiet? Quiet { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Continuous { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool SkipJogCancel { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool SilentCompletion { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CompletesCommandId { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? StopReason { get; set; }

    /// <summary>
    /// Response timeout in milliseconds. 0 = no timeout (wait indefinitely).
    /// When set, the command will be treated as failed if no ok/error is received within this time.
    /// </summary>
    [JsonIgnore]
    public int TimeoutMs { get; set; }

    // M98 macro expansion call stack — server-internal only, never sent
    // over the wire. Each entry is a macro ID currently being expanded;
    // CommandProcessor uses this to detect recursion and enforce a max
    // depth as the M98 lines fan out through nested ProcessAsync calls.
    [JsonIgnore]
    public List<int>? M98CallStack { get; set; }
}

public class CommandResult
{
    public string Id { get; set; } = "";
    public string Command { get; set; } = "";

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DisplayCommand { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public CommandMeta? Meta { get; set; }

    public string Status { get; set; } = "success"; // success, error, flushed

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ErrorMessage { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ErrorCode { get; set; }

    /// <summary>V1 parity: nested error object with message and code for client consumption.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public CommandError? Error { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool RealTime { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Data { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Timestamp { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SourceId { get; set; }
}

public class CommandError
{
    public string Message { get; set; } = "";
    public string Code { get; set; } = "";
}

public class CncError
{
    public string Code { get; set; } = "";

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? AlarmCode { get; set; }

    public string Message { get; set; } = "";

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AlarmDescription { get; set; }
}
