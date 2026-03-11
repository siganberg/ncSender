using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface ICommandProcessor
{
    Task<CommandProcessorResult> ProcessAsync(string command, CommandProcessorContext context);
}
