using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server;

public class ServerContext : IServerContext
{
    private readonly ISettingsManager _settings;

    public ServerState State { get; } = new();

    public ServerContext(ISettingsManager settings)
    {
        _settings = settings;
    }

    public string ComputeSenderStatus()
    {
        var connectionType = _settings.GetSetting<string>("connection.type");
        var normalizedType = connectionType?.ToLowerInvariant();

        if (string.IsNullOrEmpty(normalizedType) || RequiresSetup(normalizedType))
            return "setup-required";

        var connected = State.MachineState.Connected;
        var machineStatus = State.MachineState.Status?.ToLowerInvariant();
        var homed = State.MachineState.Homed;
        var isToolChanging = State.MachineState.IsToolChanging;
        var isProbing = State.MachineState.IsProbing;
        var jobIsRunning = State.JobLoaded?.Status == "running";
        var useDoorAsPause = _settings.GetSetting<bool>("useDoorAsPause");

        if (!connected)
            return "connecting";

        if (machineStatus == "alarm")
            return "alarm";

        if (machineStatus == "hold")
            return "hold";

        if (machineStatus == "door")
        {
            if (useDoorAsPause) return "hold";
            // grblHAL keeps Status="Door" through every Door:N substate
            // (the substate is dropped at parse time). When the door pin
            // releases (Pn no longer contains 'D') the machine is sitting
            // in Door:3 waiting for cycle start — promote to "hold" so the
            // Resume button is enabled instead of leaving the toolbar
            // stuck on "Door Open" forever.
            if (!(State.MachineState.Pn ?? "").Contains('D')) return "hold";
            return "door";
        }

        if (isToolChanging)
            return "tool-changing";

        if (isProbing)
            return "probing";

        if (machineStatus == "home")
            return "homing";

        if (machineStatus == "jog")
            return "jogging";

        if (machineStatus == "run" || jobIsRunning)
            return "running";

        if (machineStatus == "check")
            return "check";

        if (machineStatus == "sleep")
            return "sleep";

        if (machineStatus == "tool")
            return "tool-changing";

        // Homing-required: only if $22 bit 2 (Homing on startup required) is set.
        // Bit 0 (Enable homing) alone means the homing cycle is configured but not
        // mandatory — jogs / motion are still allowed without first homing.
        var homingCycle = State.MachineState.HomingCycle;
        if (machineStatus == "idle" && !homed && (homingCycle & 4) != 0)
            return "homing-required";

        if (machineStatus == "idle")
            return "idle";

        return connected ? "idle" : "connecting";
    }

    public bool UpdateSenderStatus()
    {
        var nextStatus = ComputeSenderStatus();
        if (State.SenderStatus != nextStatus)
        {
            State.SenderStatus = nextStatus;
            return true;
        }
        return false;
    }

    private bool RequiresSetup(string? type)
    {
        if (type == "usb")
        {
            var baudRate = _settings.GetSetting<int>("connection.baudRate", 115200);
            return baudRate <= 0;
        }

        if (type == "ethernet")
        {
            var ip = _settings.GetSetting<string>("connection.ip");
            var port = _settings.GetSetting<int>("connection.port");
            return string.IsNullOrEmpty(ip) || port <= 0;
        }

        return false;
    }
}
