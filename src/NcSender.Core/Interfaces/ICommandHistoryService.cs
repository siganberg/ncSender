namespace NcSender.Core.Interfaces;

public interface ICommandHistoryService
{
    List<string> GetHistory();
    Task AddCommandAsync(string command);
}
