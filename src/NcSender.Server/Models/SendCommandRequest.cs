namespace NcSender.Server.Models;

public class SendCommandRequest
{
    public string Command { get; set; } = "";
    public string? CommandId { get; set; }
    public string? DisplayCommand { get; set; }
    public string? SourceId { get; set; }
    public string? CompletesCommandId { get; set; }
    public SendCommandMeta? Meta { get; set; }
}

public class SendCommandMeta
{
    public string? SourceId { get; set; }
    public bool? Silent { get; set; }
    public bool? Continuous { get; set; }
    public SendCommandQuiet? Quiet { get; set; }
}

/// <summary>Wire shape of <see cref="NcSender.Core.Models.CommandQuiet"/>.</summary>
public class SendCommandQuiet
{
    public bool? TerminalCommand { get; set; }
    public bool? TerminalResponse { get; set; }
    public bool? LogCommand { get; set; }
    public bool? LogResponse { get; set; }
}
