namespace NcSender.Core.Interfaces;

public interface IJobManager
{
    bool HasActiveJob { get; }
    Task StartJobAsync();
    Task StartJobFromLineAsync(int startLine, string[]? resumeSequence);
    void Pause();
    void Resume();
    void Stop();
    void ForceReset();
}
