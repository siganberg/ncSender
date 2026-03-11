namespace NcSender.Core.Interfaces;

public interface IAlarmService
{
    string? GetAlarm(int id);
    Task FetchAndCacheAsync();
}
