using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface ICncController
{
    bool IsConnected { get; }
    string ConnectionStatus { get; }
    MachineState LastStatus { get; }
    string? RawStatusData { get; }
    string? GreetingMessage { get; }

    Task ConnectAsync(ConnectionSettings settings, CancellationToken ct = default);
    void Disconnect();
    Task<CommandResult> SendCommandAsync(string command, CommandOptions? options = null);
    Task WriteRawAsync(byte[] data, CancellationToken ct = default);
    void EnterRawMode();
    void ExitRawMode();
    IConnectionTransport? Transport { get; }
    IProtocolHandler? ActiveProtocol { get; }
    void FlushQueue(string reason);

    event Action<string, bool> ConnectionStatusChanged;
    event Action<MachineState> StatusReportReceived;
    event Action<CommandResult> CommandQueued;
    event Action<CommandResult> CommandAcknowledged;
    event Action<string, string?> DataReceived; // data, sourceId
    event Action<CncError> ErrorReceived;
    event Action StopReceived;
    event Action PauseReceived;
    event Action ResumeReceived;
    event Action UnlockReceived;
}
