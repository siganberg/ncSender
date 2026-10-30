using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

/// <summary>
/// Each controller error (error:n) and alarm (ALARM:n), once, after the
/// sender has added the controller's own description. What plugins'
/// onControllerError hook is fed from.
/// </summary>
public interface IControllerErrorFeed
{
    void Publish(CncError error);
    event Action<CncError>? Raised;
}
