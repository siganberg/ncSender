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
}
