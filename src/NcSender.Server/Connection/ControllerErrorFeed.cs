using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Connection;

public sealed class ControllerErrorFeed : IControllerErrorFeed
{
    public event Action<CncError>? Raised;
    public void Publish(CncError error) => Raised?.Invoke(error);
}
