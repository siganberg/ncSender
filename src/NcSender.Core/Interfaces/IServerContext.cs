using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IServerContext
{
    ServerState State { get; }
    string ComputeSenderStatus();
    bool UpdateSenderStatus();
}
