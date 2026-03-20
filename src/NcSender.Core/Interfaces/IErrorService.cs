namespace NcSender.Core.Interfaces;

public interface IErrorService
{
    string? GetError(int code);
    Task FetchAndCacheAsync();
}
