using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Core.Constants;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Connection;

public class CncEventBridge
{
    private readonly ICncController _controller;
    private readonly IServerContext _context;
    private readonly IBroadcaster _broadcaster;
    private readonly ILogger<CncEventBridge> _logger;
    private readonly IFirmwareService _firmwareService;
    private readonly IAlarmService _alarmService;
    private readonly IErrorService _errorService;
    private readonly IJobManager _jobManager;
    private readonly IPluginManager _pluginManager;
    private readonly ISettingsManager _settingsManager;
    private readonly IToolProjection _toolProjection;
    private readonly StateDeltaTracker _deltaTracker = new();
    private int? _lastAlarmCode; // V1 parity: persist alarm code across status reports

    private static readonly Regex PluginMessageRegex = new(
        @"\[MSG[,\s]*:?\s*PLUGIN_([^:]+):([^\]]+)\]",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public CncEventBridge(
        ICncController controller,
        IServerContext context,
        IBroadcaster broadcaster,
        ILogger<CncEventBridge> logger,
        IFirmwareService firmwareService,
        IAlarmService alarmService,
        IErrorService errorService,
        IJobManager jobManager,
        IPluginManager pluginManager,
        ISettingsManager settingsManager,
        IToolProjection toolProjection)
    {
        _toolProjection = toolProjection;
        _controller = controller;
        _context = context;
        _broadcaster = broadcaster;
        _logger = logger;
        _firmwareService = firmwareService;
        _alarmService = alarmService;
        _errorService = errorService;
        _jobManager = jobManager;
        _pluginManager = pluginManager;
        _settingsManager = settingsManager;

        _controller.StatusReportReceived += OnStatusReport;
        _controller.ConnectionStatusChanged += OnConnectionStatusChanged;
        _controller.CommandQueued += OnCommandQueued;
        _controller.CommandAcknowledged += OnCommandAcknowledged;
        _controller.DataReceived += OnDataReceived;
        _controller.ErrorReceived += OnErrorReceived;
        _controller.StopReceived += OnStop;
        _controller.PauseReceived += OnPause;
        _controller.ResumeReceived += OnResume;
        _controller.UnlockReceived += OnUnlock;

        // Initialize machineState from cached firmware (before connection)
        InitMachineStateFromFirmwareCache();
    }

    private void InitMachineStateFromFirmwareCache()
    {
        try
        {
            var firmware = _firmwareService.GetCachedAsync().GetAwaiter().GetResult();
            if (firmware?.Settings is null) return;

            if (firmware.Settings.TryGetValue("22", out var s22) && int.TryParse(s22.Value, out var hc))
            {
                _context.State.MachineState.HomingCycle = hc;
                _logger.LogInformation("Loaded machineState.HomingCycle={Value} from firmware cache", hc);
            }

            double? maxX = firmware.Settings.TryGetValue("110", out var s110) && double.TryParse(s110.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var mx) ? mx : null;
            double? maxY = firmware.Settings.TryGetValue("111", out var s111) && double.TryParse(s111.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var my) ? my : null;
            double? maxZ = firmware.Settings.TryGetValue("112", out var s112) && double.TryParse(s112.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var mz) ? mz : null;
            var validRates = new[] { maxX, maxY }.Where(v => v is > 0).ToArray();
            if (validRates.Length > 0)
                _context.State.MachineState.MaxFeedrate = validRates.Min()!.Value;
            if (maxX is > 0) _context.State.MachineState.MaxFeedrateX = maxX.Value;
            if (maxY is > 0) _context.State.MachineState.MaxFeedrateY = maxY.Value;
            if (maxZ is > 0) _context.State.MachineState.MaxFeedrateZ = maxZ.Value;

            // $120/$121/$122 = max acceleration for X/Y/Z (mm/s²). Feed into
            // MachineState so accessories (currently the pendant's Z jog
            // cap) can size behaviour to actual machine kinematics via the
            // DRO L: field.
            double? accX = firmware.Settings.TryGetValue("120", out var s120) && double.TryParse(s120.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ax) ? ax : null;
            double? accY = firmware.Settings.TryGetValue("121", out var s121) && double.TryParse(s121.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ay) ? ay : null;
            double? accZ = firmware.Settings.TryGetValue("122", out var s122) && double.TryParse(s122.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var az) ? az : null;
            if (accX is > 0) _context.State.MachineState.MaxAccelerationX = accX.Value;
            if (accY is > 0) _context.State.MachineState.MaxAccelerationY = accY.Value;
            if (accZ is > 0) _context.State.MachineState.MaxAccelerationZ = accZ.Value;

            // $130/$131/$132 = per-axis max travel (mm). Emitted via the DRO
            // E: field so accessories (currently the RGB strip's X-follower)
            // can size their overlays to real machine travel.
            double? trvX = firmware.Settings.TryGetValue("130", out var s130) && double.TryParse(s130.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var tx) ? tx : null;
            double? trvY = firmware.Settings.TryGetValue("131", out var s131) && double.TryParse(s131.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ty) ? ty : null;
            double? trvZ = firmware.Settings.TryGetValue("132", out var s132) && double.TryParse(s132.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var tz) ? tz : null;
            if (trvX is > 0) _context.State.MachineState.MaxTravelX = trvX.Value;
            if (trvY is > 0) _context.State.MachineState.MaxTravelY = trvY.Value;
            if (trvZ is > 0) _context.State.MachineState.MaxTravelZ = trvZ.Value;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not initialize machineState from firmware cache");
        }
    }

    private void BroadcastStateDelta()
    {
        var state = _context.State;
        var delta = _deltaTracker.GetDelta(state);
        if (delta is not null)
            _ = _broadcaster.Broadcast("server-state-updated", delta.Value);
    }

    private void OnStatusReport(MachineState status)
    {
        var state = _context.State;
        var prevStatus = state.MachineState.Status;

        // Merge status into machineState preserving non-report fields
        state.MachineState.Status = status.Status;
        state.MachineState.Homed = status.Homed;
        state.MachineState.Workspace = status.Workspace;
        state.MachineState.Tool = status.Tool;
        // Clears the projection once the controller catches up with the last
        // queued change; intermediate tools in a batch leave it in place.
        _toolProjection.ActualToolObserved(status.Tool);
        state.MachineState.ToolLengthSet = status.ToolLengthSet;
        state.MachineState.SpindleActive = status.SpindleActive;
        state.MachineState.FloodCoolant = status.FloodCoolant;
        state.MachineState.MistCoolant = status.MistCoolant;
        state.MachineState.FeedrateOverride = status.FeedrateOverride;
        state.MachineState.RapidOverride = status.RapidOverride;
        state.MachineState.SpindleOverride = status.SpindleOverride;
        state.MachineState.ActiveProbe = status.ActiveProbe;
        state.MachineState.ProbeCount = status.ProbeCount;
        state.MachineState.Pn = status.Pn;
        state.MachineState.FeedRate = status.FeedRate;
        state.MachineState.SpindleRpmTarget = status.SpindleRpmTarget;
        state.MachineState.SpindleRpmActual = status.SpindleRpmActual;
        state.MachineState.MPos = status.MPos;
        state.MachineState.WPos = status.WPos;
        state.MachineState.WCO = status.WCO;
        state.MachineState.Bf = status.Bf;
        state.MachineState.Ln = status.Ln;
        state.MachineState.G54 = status.G54;
        state.MachineState.G55 = status.G55;
        state.MachineState.G56 = status.G56;
        state.MachineState.G57 = status.G57;
        state.MachineState.G58 = status.G58;
        state.MachineState.G59 = status.G59;
        state.MachineState.OutputPins = status.OutputPins;
        state.MachineState.OutputPinsState = status.OutputPinsState;

        // Update job currentLine from actual executing line (Ln field from grblHAL)
        // This matches V1's getExecutingLine() which reads Ln on every state broadcast
        var job = state.JobLoaded;
        if (job is not null && job.Status is "running" && status.Ln > 0)
        {
            job.CurrentLine = status.Ln;

            if (job.TotalLines > 0)
                job.ProgressPercent = Math.Round((double)status.Ln / job.TotalLines * 100, 2);
        }

        if (status.Axes is not null)
        {
            state.MachineState.Axes = status.Axes;
            state.MachineState.AxisCount = status.AxisCount;
        }

        // Stop running job when machine enters alarm state (matching V1 cnc-events.js)
        if (string.Equals(status.Status, "Alarm", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(prevStatus, "Alarm", StringComparison.OrdinalIgnoreCase)
            && _jobManager.HasActiveJob)
        {
            _logger.LogInformation("Machine entered alarm state, resetting job manager");
            _jobManager.ForceReset();
        }

        // V1 parity: repopulate alarm info on every status report when in alarm,
        // or clear it when no longer in alarm
        if (string.Equals(status.Status, "Alarm", StringComparison.OrdinalIgnoreCase))
        {
            if (_lastAlarmCode is int code)
            {
                state.MachineState.AlarmCode = code;
                state.MachineState.AlarmDescription = _alarmService.GetAlarm(code)
                    ?? GrblAlarms.GetMessage(code);
            }
            else
            {
                // No ALARM:X received yet (e.g. connected to already-alarmed controller)
                // V1 sets alarmCode=null, alarmDescription="Unknown Alarm" so the UI
                // still shows the alarm overlay with the unlock button
                state.MachineState.AlarmCode = null;
                state.MachineState.AlarmDescription = "Unknown Alarm";
            }
        }
        else
        {
            state.MachineState.AlarmCode = null;
            state.MachineState.AlarmDescription = null;
            _lastAlarmCode = null;
        }

        _context.UpdateSenderStatus();
        state.GreetingMessage = _controller.GreetingMessage;

        BroadcastStateDelta();
    }

    private void OnConnectionStatusChanged(string status, bool isConnected)
    {
        var state = _context.State;
        state.MachineState.Connected = isConnected;

        // Anything queued is gone across a connect/disconnect boundary.
        _toolProjection.Reset();

        if (isConnected)
        {
            var greeting = _controller.GreetingMessage;
            if (greeting is not null)
                state.GreetingMessage = greeting;

            // Fetch firmware/alarm data on connection
            _ = Task.Run(async () =>
            {
                try
                {
                    // Small delay to let the controller settle
                    await Task.Delay(1000);

                    await _firmwareService.RefreshAsync(force: false);
                    await _alarmService.FetchAndCacheAsync();
                    await _errorService.FetchAndCacheAsync();

                    // Initialize machineState from firmware settings (matching V1 cnc-events.js)
                    var firmware = await _firmwareService.GetCachedAsync();
                    if (firmware?.Settings is not null)
                    {
                        // $22 = homing cycle (bitwise value)
                        if (firmware.Settings.TryGetValue("22", out var setting22) && setting22.Value is not null)
                        {
                            var val = int.TryParse(setting22.Value, out var hc) ? hc : 0;
                            state.MachineState.HomingCycle = val;
                            _logger.LogInformation("Initialized machineState.HomingCycle to {Value} (from $22={Raw})", val, setting22.Value);
                        }

                        // $110, $111, $112 = max feedrates for X, Y, Z (mm/min)
                        double? maxX = firmware.Settings.TryGetValue("110", out var s110) && double.TryParse(s110.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var mx) ? mx : null;
                        double? maxY = firmware.Settings.TryGetValue("111", out var s111) && double.TryParse(s111.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var my) ? my : null;
                        double? maxZ = firmware.Settings.TryGetValue("112", out var s112) && double.TryParse(s112.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var mz) ? mz : null;
                        var validRates = new[] { maxX, maxY }.Where(v => v is > 0).ToArray();
                        if (validRates.Length > 0)
                        {
                            state.MachineState.MaxFeedrate = validRates.Min()!.Value;
                            _logger.LogInformation("Initialized machineState.MaxFeedrate to {Value} (from $110={X}, $111={Y})", state.MachineState.MaxFeedrate, maxX, maxY);
                        }
                        if (maxX is > 0) state.MachineState.MaxFeedrateX = maxX.Value;
                        if (maxY is > 0) state.MachineState.MaxFeedrateY = maxY.Value;
                        if (maxZ is > 0) state.MachineState.MaxFeedrateZ = maxZ.Value;

                        // $120/$121/$122 = per-axis max acceleration (mm/s²)
                        double? accX = firmware.Settings.TryGetValue("120", out var s120) && double.TryParse(s120.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ax) ? ax : null;
                        double? accY = firmware.Settings.TryGetValue("121", out var s121) && double.TryParse(s121.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ay) ? ay : null;
                        double? accZ = firmware.Settings.TryGetValue("122", out var s122) && double.TryParse(s122.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var az) ? az : null;
                        if (accX is > 0) state.MachineState.MaxAccelerationX = accX.Value;
                        if (accY is > 0) state.MachineState.MaxAccelerationY = accY.Value;
                        if (accZ is > 0) state.MachineState.MaxAccelerationZ = accZ.Value;

                        // $130/$131/$132 = per-axis max travel (mm)
                        double? trvX = firmware.Settings.TryGetValue("130", out var s130) && double.TryParse(s130.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var tx) ? tx : null;
                        double? trvY = firmware.Settings.TryGetValue("131", out var s131) && double.TryParse(s131.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ty) ? ty : null;
                        double? trvZ = firmware.Settings.TryGetValue("132", out var s132t) && double.TryParse(s132t.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var tz) ? tz : null;
                        if (trvX is > 0) state.MachineState.MaxTravelX = trvX.Value;
                        if (trvY is > 0) state.MachineState.MaxTravelY = trvY.Value;
                        if (trvZ is > 0) state.MachineState.MaxTravelZ = trvZ.Value;

                        // Broadcast key settings so client updates reactively
                        foreach (var id in new[] { "32", "130", "131", "132" })
                        {
                            if (firmware.Settings.TryGetValue(id, out var setting) && setting.Value is not null)
                            {
                                await _broadcaster.Broadcast("firmware-setting-changed",
                                    new WsFirmwareSettingChanged(id, setting.Value),
                                    NcSenderJsonContext.Default.WsFirmwareSettingChanged);
                                _logger.LogInformation("Broadcast ${Id}={Value} on connection", id, setting.Value);
                            }
                        }

                        _context.UpdateSenderStatus();
                        BroadcastStateDelta();
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to refresh firmware/alarm data on connect");
                }
            });
        }

        _context.UpdateSenderStatus();
        BroadcastStateDelta();
    }

    private void OnCommandQueued(CommandResult cmd)
    {
        if (cmd.Meta?.SourceId == "system" || cmd.Meta?.Silent == true
            || cmd.Meta?.Quiet?.TerminalCommand == true)
            return;

        cmd.DisplayCommand = FormatCommandText(cmd.DisplayCommand ?? cmd.Command);
        cmd.SourceId = cmd.Meta?.SourceId;
        _ = _broadcaster.Broadcast("cnc-command", cmd, NcSenderJsonContext.Default.CommandResult);
    }

    private static readonly Regex FirmwareSettingRegex = new(@"^\$(\d+)=\s*(.+)$", RegexOptions.Compiled);

    private void OnCommandAcknowledged(CommandResult cmd)
    {
        // Detect firmware setting changes ($XX=YY) on successful commands
        if (cmd.Status == "success" && cmd.Command is not null)
            _ = HandleFirmwareSettingChange(cmd.Command);

        // Refresh tool number after M61 (set tool) — FluidNC only reports tool in [GC:]
        if (cmd.Status == "success" && cmd.Command is not null &&
            cmd.Command.Contains("M61", StringComparison.OrdinalIgnoreCase))
        {
            _ = _controller.SendCommandAsync("$G", new CommandOptions { Meta = new CommandMeta { SourceId = "system" } });
        }

        if (cmd.Meta?.SourceId == "system" || cmd.Meta?.Silent == true
            || cmd.Meta?.Quiet?.TerminalCommand == true)
            return;

        cmd.DisplayCommand = FormatCommandText(cmd.DisplayCommand ?? cmd.Command);
        cmd.SourceId = cmd.Meta?.SourceId;

        // V1 parity: convert flushed → error with nested error object
        if (cmd.Status == "flushed")
        {
            cmd.Status = "error";
            cmd.Error = new CommandError
            {
                Message = "Command flushed: likely due to connection loss or controller reset",
                Code = "FLUSHED"
            };
        }

        // Enrich error messages with controller-specific descriptions when available
        if (cmd.Status == "error" && cmd.ErrorCode is int errorCode)
        {
            var richMessage = _errorService.GetError(errorCode);
            if (richMessage is not null)
                cmd.ErrorMessage = richMessage;
        }

        // Continuous jog success: send with silentCompletion so UI clears pending
        // state without adding a new terminal line
        if (cmd.Status == "success" && cmd.Meta?.Continuous == true)
        {
            cmd.Meta.SilentCompletion = true;
        }

        _ = _broadcaster.Broadcast("cnc-command-result", cmd, NcSenderJsonContext.Default.CommandResult);
    }

    /// <summary>
    /// When a $XX=YY command succeeds, update firmware cache and broadcast changes.
    /// Matches V1's handleFirmwareAck in cnc-events.js.
    /// </summary>
    private async Task HandleFirmwareSettingChange(string command)
    {
        try
        {
            var match = FirmwareSettingRegex.Match(command);
            if (!match.Success) return;

            var id = match.Groups[1].Value;
            var newValue = match.Groups[2].Value.Trim();

            // Update firmware cache
            var firmware = await _firmwareService.GetCachedAsync();
            if (firmware is null) return;

            var oldValue = firmware.Settings.TryGetValue(id, out var existing) ? existing.Value : null;
            var valueChanged = oldValue != newValue;

            if (existing is not null)
                existing.Value = newValue;
            else
                firmware.Settings[id] = new FirmwareSetting { Id = int.TryParse(id, out var n) ? n : 0, Value = newValue };

            _logger.LogInformation("Updated firmware setting ${Id}={Value}", id, newValue);

            // Persist updated firmware cache
            await _firmwareService.SaveCacheAsync();

            if (!valueChanged) return;

            // $22 → update machineState.homingCycle
            if (id == "22")
            {
                var val = int.TryParse(newValue, out var hc) ? hc : 0;
                _context.State.MachineState.HomingCycle = val;
                _logger.LogInformation("Updated machineState.HomingCycle to {Value} (from $22={Raw})", val, newValue);
                BroadcastStateDelta();
            }

            // $32/$130/$131/$132 → broadcast firmware-setting-changed for visualizer
            if (id is "32" or "130" or "131" or "132")
            {
                _ = _broadcaster.Broadcast("firmware-setting-changed",
                    new WsFirmwareSettingChanged(id, newValue),
                    NcSenderJsonContext.Default.WsFirmwareSettingChanged);
            }

            // $110/$111/$112 → update machineState.maxFeedrate (per-axis)
            if (id is "110" or "111" or "112")
            {
                double? maxX = firmware.Settings.TryGetValue("110", out var s110) && double.TryParse(s110.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var mx) ? mx : null;
                double? maxY = firmware.Settings.TryGetValue("111", out var s111) && double.TryParse(s111.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var my) ? my : null;
                double? maxZ = firmware.Settings.TryGetValue("112", out var s112z) && double.TryParse(s112z.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var mz) ? mz : null;
                var validRates = new[] { maxX, maxY }.Where(v => v is > 0).ToArray();
                if (validRates.Length > 0)
                {
                    _context.State.MachineState.MaxFeedrate = validRates.Min()!.Value;
                    _logger.LogInformation("Updated machineState.MaxFeedrate to {Value}", _context.State.MachineState.MaxFeedrate);
                }
                if (maxX is > 0) _context.State.MachineState.MaxFeedrateX = maxX.Value;
                if (maxY is > 0) _context.State.MachineState.MaxFeedrateY = maxY.Value;
                if (maxZ is > 0) _context.State.MachineState.MaxFeedrateZ = maxZ.Value;
                BroadcastStateDelta();
            }

            // $120/$121/$122 → update machineState.maxAcceleration (per-axis)
            if (id is "120" or "121" or "122")
            {
                double? accX = firmware.Settings.TryGetValue("120", out var s120a) && double.TryParse(s120a.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ax) ? ax : null;
                double? accY = firmware.Settings.TryGetValue("121", out var s121a) && double.TryParse(s121a.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ay) ? ay : null;
                double? accZ = firmware.Settings.TryGetValue("122", out var s122a) && double.TryParse(s122a.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var az) ? az : null;
                if (accX is > 0) _context.State.MachineState.MaxAccelerationX = accX.Value;
                if (accY is > 0) _context.State.MachineState.MaxAccelerationY = accY.Value;
                if (accZ is > 0) _context.State.MachineState.MaxAccelerationZ = accZ.Value;
                BroadcastStateDelta();
            }

            // $130/$131/$132 → update machineState.maxTravel (per-axis)
            if (id is "130" or "131" or "132")
            {
                double? trvX = firmware.Settings.TryGetValue("130", out var s130a) && double.TryParse(s130a.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var tx) ? tx : null;
                double? trvY = firmware.Settings.TryGetValue("131", out var s131a) && double.TryParse(s131a.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ty) ? ty : null;
                double? trvZ = firmware.Settings.TryGetValue("132", out var s132a) && double.TryParse(s132a.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var tz) ? tz : null;
                if (trvX is > 0) _context.State.MachineState.MaxTravelX = trvX.Value;
                if (trvY is > 0) _context.State.MachineState.MaxTravelY = trvY.Value;
                if (trvZ is > 0) _context.State.MachineState.MaxTravelZ = trvZ.Value;
                BroadcastStateDelta();
            }

            // Check if setting requires restart (halDetails[7] === '1')
            if (existing?.HalDetails is not null && existing.HalDetails.Count > 7 && existing.HalDetails[7] == "1")
            {
                var msg = $"(Setting ${id} changed - Controller restart required for changes to take effect)";
                _ = _broadcaster.Broadcast("cnc-data", msg, NcSenderJsonContext.Default.String);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to handle firmware setting change");
        }
    }

    private void OnDataReceived(string data, string? sourceId)
    {
        // Detect TOOL_CHANGE_START sentinel — prepended to every M6/TLS
        // expansion (see PluginCommandProcessor). Firing on the controller's
        // echo means each M6 in a macro batch flips the flag right when its
        // sub-commands actually start executing, regardless of expansion
        // batching. Idempotent set so multiple starts don't cause churn.
        if (data.Contains("TOOL_CHANGE_START", StringComparison.OrdinalIgnoreCase))
        {
            var state = _context.State;
            if (!state.MachineState.IsToolChanging)
            {
                state.MachineState.IsToolChanging = true;
                _context.UpdateSenderStatus();
                BroadcastStateDelta();
                _logger.LogInformation("Tool change start");
            }
            return;
        }

        // Detect TOOL_CHANGE_COMPLETE sentinel
        if (data.Contains("TOOL_CHANGE_COMPLETE", StringComparison.OrdinalIgnoreCase))
        {
            // Retire one queued change. Until the count reaches zero the
            // projection stays authoritative, because the tool the controller
            // is reporting belongs to an earlier point in the batch.
            _toolProjection.ToolChangeCompleted();

            var state = _context.State;
            if (state.MachineState.IsToolChanging)
            {
                state.MachineState.IsToolChanging = false;
                _context.UpdateSenderStatus();
                BroadcastStateDelta();
                _logger.LogInformation("Tool change complete");

                // Refresh G-code modes to pick up new tool number
                // (FluidNC only reports tool in [GC:] response, not in status report)
                _ = _controller.SendCommandAsync("$G", new CommandOptions { Meta = new CommandMeta { SourceId = "system" } });
            }
            return;
        }

        // Detect [MSG:PLUGIN_*:*] — show plugin safety dialog (matches V1 plugin event handler)
        if (data.Contains("PLUGIN_", StringComparison.OrdinalIgnoreCase))
        {
            var pluginMatch = PluginMessageRegex.Match(data);
            if (pluginMatch.Success)
            {
                var normalizedName = pluginMatch.Groups[1].Value;
                var messageCode = pluginMatch.Groups[2].Value;
                HandlePluginMessage(normalizedName, messageCode, data);
            }
        }

        if (sourceId == "system")
            return;

        // Controller output for a command whose sender asked for a quiet
        // terminal — e.g. a plugin polling an aux input, where every reply
        // would otherwise scroll the operator's terminal. It still has to
        // reach plugin dialogs: the point is to keep the answer off the
        // operator's screen, not to withhold it from whoever asked. The
        // terminal only listens to cnc-data, so a separate channel splits
        // the two without changing either payload.
        if (_controller.ActiveCommandMeta?.Quiet?.TerminalResponse == true)
        {
            _ = _broadcaster.Broadcast("cnc-data-quiet", data, NcSenderJsonContext.Default.String);
            return;
        }

        // When greeting arrives, store it and broadcast to all connected clients
        // (WebSocket clients may have connected before the greeting was captured)
        if (_controller.ActiveProtocol is not null && _controller.ActiveProtocol.MatchesGreeting(data))
        {
            _context.State.GreetingMessage = data;
            _context.State.DisplayFirmware = _controller.ActiveProtocol.SupportsSettingEnumeration;
            _context.State.DisplayConfig = !_controller.ActiveProtocol.SupportsSettingEnumeration;
            _ = _broadcaster.Broadcast("initial-greeting",
                System.Text.Json.JsonSerializer.SerializeToElement(data, NcSenderJsonContext.Default.String));

            // Refresh G-code parser state — soft-reset (0x18) clears modal state
            // (workspace, units, plane, etc.) and the status report doesn't echo
            // them, so the client's workspace dropdown would otherwise stay stale.
            _ = _controller.SendCommandAsync("$G", new CommandOptions { Meta = new CommandMeta { SourceId = "system" } });
            return;
        }

        _ = _broadcaster.Broadcast("cnc-data", data, NcSenderJsonContext.Default.String);
    }

    private void HandlePluginMessage(string normalizedName, string messageCode, string rawData)
    {
        var dialog = _pluginManager.GetPluginMessageDialog(normalizedName, messageCode);
        if (dialog is null)
        {
            _logger.LogDebug("No dialog config for plugin message {Name}:{Code}", normalizedName, messageCode);
            return;
        }

        // Extract tool number from suffix (e.g. LOAD_MESSAGE_MANUAL_5 → "5")
        var lastUnderscore = messageCode.LastIndexOf('_');
        if (lastUnderscore > 0 && int.TryParse(messageCode[(lastUnderscore + 1)..], out var toolNum))
        {
            var isFailure = messageCode.Contains("FAILED_", StringComparison.OrdinalIgnoreCase);
            var styled = isFailure
                ? $"<strong style=\"color: var(--color-accent); font-size: 1.35em;\">T{toolNum}</strong>"
                : $"<strong style=\"color: var(--color-accent);\">T{toolNum}</strong>";
            dialog.Message = dialog.Message.Replace("{toolNumber}", styled);
        }
        else
        {
            dialog.Message = dialog.Message.Replace("{toolNumber}", "the tool");
        }

        _logger.LogInformation("Plugin message {Name}:{Code} — showing dialog: {Title}",
            normalizedName, messageCode, dialog.Title);

        var html = BuildSafetyDialogHtml(dialog);

        // Broadcast via plugin:show-modal (V1 parity — renders in ModalDialog, not PluginDialog)
        _ = _broadcaster.Broadcast("plugin:show-modal",
            new WsShowModal(dialog.PluginId, html, Closable: false),
            NcSenderJsonContext.Default.WsShowModal);

        // Persist dialog payload so it survives page refresh / server restart (V1 parity)
        PersistPluginMessageAsync(normalizedName, messageCode, rawData, dialog, html);

        async void PersistPluginMessageAsync(string pluginCode, string msgCode, string raw,
            PluginDialogInfo dlg, string htmlContent)
        {
            try
            {
                await _settingsManager.SaveSettings(new JsonObject
                {
                    ["pluginMessage"] = new JsonObject
                    {
                        ["pluginCode"] = pluginCode,
                        ["messageId"] = msgCode,
                        ["rawData"] = raw,
                        ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        ["modalPayload"] = new JsonObject
                        {
                            ["pluginId"] = dlg.PluginId,
                            ["content"] = htmlContent,
                            ["closable"] = false
                        }
                    }
                });
                _logger.LogInformation("Persisted pluginMessage to settings.json");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to persist pluginMessage to settings.json");
            }
        }
    }

    private static string BuildHoldHint(int holdMs, int countdownSec, bool chainSteps)
    {
        static string SecondsNoun(double n)
        {
            var text = n == Math.Floor(n) ? $"{(int)n}" : $"{n:0.#}";
            return $"{text} {(Math.Abs(n - 1) < 0.001 ? "second" : "seconds")}";
        }
        static string SecondsAttr(double n)
        {
            var text = n == Math.Floor(n) ? $"{(int)n}" : $"{n:0.#}";
            return $"{text}-second";
        }
        var holdText = SecondsNoun(holdMs / 1000.0);
        var countdownAttr = SecondsAttr(countdownSec);
        var chainNote = chainSteps
            ? $" Chain mode is on. One arm runs every remaining step, each with its own {countdownAttr} countdown."
            : "";
        return $"<div class=\"rcs-hold-hint\">Tap to arm a {countdownAttr} countdown, so you have time to walk to the spindle first. Press and hold for {holdText} to fire it right away.{chainNote}</div>";
    }

    private static string BuildSafetyDialogHtml(PluginDialogInfo dialog)
    {
        var abortGcodeLines = !string.IsNullOrWhiteSpace(dialog.AbortEventGcode)
            ? dialog.AbortEventGcode.Trim().Split('\n')
                .Select(line => line.Trim())
                .Where(line => line.Length > 0)
                .ToArray()
            : Array.Empty<string>();

        var abortGcodeJson = System.Text.Json.JsonSerializer.Serialize(abortGcodeLines, NcSenderJsonContext.Default.StringArray);

        // Optional in-sequence action steps (Release → Clamp / etc.).
        // Rendered as ONE morphing button: its label and gcode advance
        // through the sequence as the operator taps/holds it. This keeps
        // the dialog compact and mirrors real hardware — a single
        // "current action" button that walks the sequence.
        var extraButtons = dialog.Buttons ?? new List<PluginDialogButton>();
        var hasExtras = extraButtons.Count > 0;
        var firstLabel = hasExtras
            ? System.Net.WebUtility.HtmlEncode(extraButtons[0].Label)
            : "";
        var extraButtonsMarkup = hasExtras
            ? $"<button class=\"rcs-action-button rcs-button-extra\" id=\"rcs-extra-btn\">{firstLabel}</button>"
            : "";

        // Labels + gcode arrays for each step — serialized manually to
        // avoid reflection under AOT.
        var labelSb = new System.Text.StringBuilder("[");
        var gcodeSb = new System.Text.StringBuilder("[");
        for (var i = 0; i < extraButtons.Count; i += 1)
        {
            if (i > 0) { labelSb.Append(','); gcodeSb.Append(','); }
            labelSb.Append(System.Text.Json.JsonSerializer.Serialize(
                extraButtons[i].Label ?? "", NcSenderJsonContext.Default.String));
            var lines = extraButtons[i].Gcode ?? new List<string>();
            gcodeSb.Append(System.Text.Json.JsonSerializer.Serialize(
                lines.ToArray(), NcSenderJsonContext.Default.StringArray));
        }
        labelSb.Append(']');
        gcodeSb.Append(']');
        var extraLabelsJson = labelSb.ToString();
        var extraGcodeJson = gcodeSb.ToString();

        // Plugin-configurable dialog timing. Sensible defaults apply if the
        // plugin hasn't written them into its settings.
        var holdMs = dialog.HoldMs.GetValueOrDefault(1000);
        var countdownSec = dialog.CountdownSec.GetValueOrDefault(5);
        var chainStepsJs = dialog.ChainSteps.GetValueOrDefault(false) ? "true" : "false";

        return $$"""
        <style>
          .rcs-safety-container {
            background: var(--color-surface);
            border-radius: var(--radius-medium);
            padding: 32px;
            max-width: 500px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          }

          .rcs-safety-header {
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--color-text-primary);
            margin-bottom: 24px;
            text-align: center;
          }

          .rcs-safety-dialog {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }

          .rcs-safety-message {
            font-size: 1rem;
            line-height: 1.5;
            color: var(--color-text-primary);
            background: color-mix(in srgb, var(--color-warning) 15%, transparent);
            border: 2px solid var(--color-warning);
            border-radius: var(--radius-small);
            padding: 16px;
          }

          .rcs-hold-hint {
            font-size: 0.85rem;
            line-height: 1.4;
            color: var(--color-text-secondary);
            text-align: center;
            margin-top: -8px;
          }

          .rcs-safety-actions {
            display: flex;
            justify-content: center;
            gap: 12px;
          }

          .rcs-action-button {
            padding: 12px 24px;
            border: none;
            border-radius: var(--radius-small);
            font-weight: 600;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.2s ease;
            min-width: 120px;
            flex: 0 0 auto;
          }

          .rcs-action-button:hover {
            opacity: 0.9;
          }

          .rcs-action-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .rcs-button-abort {
            background: var(--color-error, #dc2626);
            color: white;
          }

          .rcs-button-continue {
            background: var(--color-success, #16a34a);
            color: white;
          }

          .rcs-button-extra {
            background-color: var(--color-accent, #2563eb);
            background-repeat: no-repeat;
            color: white;
            overflow: hidden;
            -webkit-user-select: none;
            user-select: none;
            -webkit-touch-callout: none;
            touch-action: manipulation;
          }
        </style>

        <div class="rcs-safety-container">
          <div class="rcs-safety-header">{{dialog.Title}}</div>
          <div class="rcs-safety-dialog">
            <div class="rcs-safety-message">{{dialog.Message}}</div>
            {{(hasExtras ? BuildHoldHint(holdMs, countdownSec, dialog.ChainSteps.GetValueOrDefault(false)) : "")}}
            <div class="rcs-safety-actions">
              <button class="rcs-action-button rcs-button-abort" id="rcs-abort-btn">Abort</button>
              {{extraButtonsMarkup}}
              <button class="rcs-action-button rcs-button-continue" id="rcs-continue-btn" {{(hasExtras ? "disabled" : "")}}>{{dialog.ContinueLabel}}</button>
            </div>
          </div>
        </div>

        <script>
          (function() {
            var abortGcodeLines = {{abortGcodeJson}};
            var extraLabels = {{extraLabelsJson}};
            var extraGcodeArrays = {{extraGcodeJson}};
            var extraCount = extraGcodeArrays.length;
            // A single morphing extra button walks the step sequence
            // (Release → Clamp / etc.). Two gestures supported:
            //   - Short tap → immediate action.
            //   - Hold →     arms a countdown; auto-executes at 0.
            // The hold gesture lets the operator arm the drawbar release/
            // clamp on the touch screen, then walk to the spindle before it
            // fires. Durations come from plugin settings.
            var HOLD_MS = {{holdMs}};
            var COUNTDOWN_SEC = {{countdownSec}};
            var CHAIN_STEPS = {{chainStepsJs}};
            var nextExtraIdx = 0;
            var extraBtn = document.getElementById('rcs-extra-btn');
            var state = {
              holdTimer: null,
              countdownTimer: null,
              armed: false
            };

            function enableContinue() {
              var c = document.getElementById('rcs-continue-btn');
              if (c) c.disabled = false;
            }

            function currentLabel() {
              return extraLabels[nextExtraIdx] || '';
            }

            // Hold-fill overlay: a translucent white layer that grows from
            // 0% width to 100% width across the button over HOLD_MS. Matches
            // the long-press feedback used elsewhere in ncSender.
            var HOLD_FILL_IMAGE = 'linear-gradient(rgba(255,255,255,0.35), rgba(255,255,255,0.35))';
            function beginHoldFill() {
              if (!extraBtn) return;
              extraBtn.style.backgroundImage = HOLD_FILL_IMAGE;
              extraBtn.style.transition = 'none';
              extraBtn.style.backgroundSize = '0% 100%';
              // Force reflow so the transition applies from 0%.
              void extraBtn.offsetWidth;
              extraBtn.style.transition = 'background-size ' + HOLD_MS + 'ms linear';
              extraBtn.style.backgroundSize = '100% 100%';
            }
            function clearHoldFill() {
              if (!extraBtn) return;
              extraBtn.style.transition = 'none';
              extraBtn.style.backgroundImage = '';
              extraBtn.style.backgroundSize = '';
            }

            function clearExtraTimers() {
              if (state.holdTimer !== null) { clearTimeout(state.holdTimer); state.holdTimer = null; }
              if (state.countdownTimer !== null) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
              state.armed = false;
            }

            function executeExtra() {
              if (!extraBtn || nextExtraIdx >= extraCount) return;
              var gcode = extraGcodeArrays[nextExtraIdx] || [];
              var justFiredLabel = extraLabels[nextExtraIdx] || '';
              var wasChained = CHAIN_STEPS && state.armed;
              clearExtraTimers();
              clearHoldFill();
              gcode.forEach(function(line) {
                window.postMessage({ type: 'send-command', command: line, displayCommand: line }, '*');
              });
              nextExtraIdx += 1;
              if (nextExtraIdx < extraCount) {
                extraBtn.textContent = currentLabel();
                // Chain mode: the user armed once; keep the countdown
                // rolling through every remaining step without another
                // long-press.
                if (wasChained) startCountdown();
              } else {
                // Strip any trailing "(Ns)" countdown so the disabled
                // button doesn't freeze on "Clamp (1s)".
                extraBtn.textContent = justFiredLabel;
                extraBtn.disabled = true;
                enableContinue();
              }
            }

            function startCountdown() {
              if (!extraBtn) return;
              state.armed = true;
              var label = currentLabel();
              var remaining = COUNTDOWN_SEC;
              extraBtn.textContent = label + ' (' + remaining + 's)';
              state.countdownTimer = setInterval(function() {
                remaining -= 1;
                if (remaining <= 0) {
                  executeExtra();
                } else {
                  extraBtn.textContent = label + ' (' + remaining + 's)';
                }
              }, 1000);
            }

            if (extraBtn) {
              // Gesture mapping — safer default is countdown on short tap,
              // immediate fire only on deliberate long-press:
              //   - Short tap (release before HOLD_MS) → arm countdown.
              //   - Hold ≥ HOLD_MS → immediate execute.
              extraBtn.addEventListener('pointerdown', function() {
                if (extraBtn.disabled || state.armed || nextExtraIdx >= extraCount) return;
                if (state.holdTimer !== null) return;
                beginHoldFill();
                state.holdTimer = setTimeout(function() {
                  state.holdTimer = null;
                  clearHoldFill();
                  executeExtra();
                }, HOLD_MS);
              });
              function cancelHoldAndMaybeArm(arm) {
                if (state.holdTimer === null) return;
                clearTimeout(state.holdTimer);
                state.holdTimer = null;
                clearHoldFill();
                if (arm && !extraBtn.disabled && !state.armed && nextExtraIdx < extraCount) {
                  startCountdown();
                }
              }
              extraBtn.addEventListener('pointerup', function() { cancelHoldAndMaybeArm(true); });
              extraBtn.addEventListener('pointerleave', function() { cancelHoldAndMaybeArm(false); });
              extraBtn.addEventListener('pointercancel', function() { cancelHoldAndMaybeArm(false); });
              // Long-press context menu on touch would swallow pointerup.
              extraBtn.addEventListener('contextmenu', function(e) { e.preventDefault(); });
            }

            if (extraCount === 0) enableContinue();

            if (window.__rcsClickHandler) {
              document.removeEventListener('click', window.__rcsClickHandler, true);
            }
            function handler(e) {
              var t = e.target;
              if (!t || t.disabled) return;
              if (t.id === 'rcs-abort-btn') {
                t.disabled = true;
                var c = document.getElementById('rcs-continue-btn');
                if (c) c.disabled = true;
                clearExtraTimers();
                if (extraBtn) extraBtn.disabled = true;
                // Soft-reset FIRST so any lines still buffered from the
                // interrupted program (M6 macro, TLS routine, etc.) are
                // purged. abortGcodeLines would otherwise be discarded
                // by the reset that follows. Then send the plugin's abort
                // gcode to the reset-clean machine after a brief pause so
                // grblHAL is ready to accept commands.
                window.postMessage({ type: 'send-command', command: '\x18', displayCommand: '\x18 (Soft Reset)' }, '*');
                setTimeout(function() {
                  if (abortGcodeLines.length > 0) {
                    abortGcodeLines.forEach(function(line) {
                      window.postMessage({ type: 'send-command', command: line, displayCommand: line }, '*');
                    });
                  }
                  window.postMessage({ type: 'send-command', command: '$NCSENDER_CLEAR_MSG', displayCommand: '$NCSENDER_CLEAR_MSG' }, '*');
                }, 200);
                document.removeEventListener('click', handler, true);
                delete window.__rcsClickHandler;
                return;
              }
              if (t.id === 'rcs-continue-btn') {
                t.disabled = true;
                var a = document.getElementById('rcs-abort-btn');
                if (a) a.disabled = true;
                // Send `~` to resume. If a safety door was opened while
                // the M0 pause was active, grblHAL stacks Door on top of
                // Hold — one ~ only clears the Door state, leaving the
                // underlying M0 Hold in place. Send a second ~ after a
                // short delay so the M0 also releases. When only one
                // pause was active the second ~ is a harmless no-op
                // (grblHAL ignores ~ in Idle/Run).
                window.postMessage({ type: 'send-command', command: '~', displayCommand: '~ (Cycle Start)' }, '*');
                window.postMessage({ type: 'send-command', command: '$NCSENDER_CLEAR_MSG', displayCommand: '$NCSENDER_CLEAR_MSG' }, '*');
                setTimeout(function() {
                  window.postMessage({ type: 'send-command', command: '~', displayCommand: '~ (Cycle Start)' }, '*');
                }, 500);
                document.removeEventListener('click', handler, true);
                delete window.__rcsClickHandler;
              }
            }
            window.__rcsClickHandler = handler;
            document.addEventListener('click', handler, true);
          })();
        </script>
        """;
    }

    // Matches V1's formatCommandText: map known realtime commands, escape control chars
    private static readonly Dictionary<char, string> RealtimeCommandNames = new()
    {
        ['\x18'] = "0x18 (Soft Reset)",
        ['\x85'] = "0x85 (Jog Cancel)",
        ['\x84'] = "0x84 (Safety Door)",
        ['\x87'] = "0x87 (Status Report)",
        ['\x90'] = "0x90 (Feed Rate Override Reset 100%)",
        ['\x91'] = "0x91 (Feed Rate Override +10%)",
        ['\x92'] = "0x92 (Feed Rate Override -10%)",
        ['\x93'] = "0x93 (Feed Rate Override +1%)",
        ['\x94'] = "0x94 (Feed Rate Override -1%)",
        ['\x99'] = "0x99 (Spindle Speed Override Reset 100%)",
        ['\x9A'] = "0x9A (Spindle Speed Override +10%)",
        ['\x9B'] = "0x9B (Spindle Speed Override -10%)",
        ['\x9C'] = "0x9C (Spindle Speed Override +1%)",
        ['\x9D'] = "0x9D (Spindle Speed Override -1%)",
        ['!'] = "! (Feed Hold)",
        ['~'] = "~ (Cycle Start/Resume)"
    };

    private static string? FormatCommandText(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        // Single-char known realtime command
        if (value.Length == 1 && RealtimeCommandNames.TryGetValue(value[0], out var name))
            return name;

        // Escape control characters to hex (preserve newlines)
        var needsEscaping = false;
        foreach (var ch in value)
        {
            if ((ch < 0x20 && ch != '\n') || ch == 0x7F)
            {
                needsEscaping = true;
                break;
            }
        }

        if (!needsEscaping)
            return value;

        var sb = new System.Text.StringBuilder(value.Length * 2);
        foreach (var ch in value)
        {
            if (ch == '\n')
                sb.Append('\n');
            else if (ch < 0x20 || ch == 0x7F)
                sb.Append($"0x{(int)ch:X2}");
            else
                sb.Append(ch);
        }
        return sb.ToString();
    }

    private void OnErrorReceived(CncError error)
    {
        // Enrich error messages with controller-fetched descriptions
        if (error.Code != "ALARM" && int.TryParse(error.Code, out var errCode))
        {
            var richMessage = _errorService.GetError(errCode);
            if (richMessage is not null)
                error.Message = richMessage;
            error.Message += " (Jog any axis to clear error state)";
        }

        // Populate alarm info on machineState so the client can display the alarm overlay
        if (error.Code == "ALARM" && error.AlarmCode is int code)
        {
            _lastAlarmCode = code;

            var description = _alarmService.GetAlarm(code)
                ?? GrblAlarms.GetMessage(code);

            // Enrich the cnc-error with alarm description (V1 parity)
            error.AlarmDescription = description;

            var state = _context.State;
            state.MachineState.AlarmCode = code;
            state.MachineState.AlarmDescription = description;
            _context.UpdateSenderStatus();
            BroadcastStateDelta();
        }

        _ = _broadcaster.Broadcast("cnc-error", error, NcSenderJsonContext.Default.CncError);
    }

    private void OnStop()
    {
        var state = _context.State;
        if (state.MachineState.IsToolChanging)
        {
            state.MachineState.IsToolChanging = false;
        }

        // A soft reset / stop flushes the queue, so any M6 we projected will
        // never run. Fall back to observed state instead of staying stuck on
        // a tool that was never loaded.
        _toolProjection.Reset();

        // Update job state if a job is running/paused
        var job = state.JobLoaded;
        if (job is not null && job.Status is "running" or "paused")
        {
            job.Status = "stopped";
            job.JobEndTime = DateTime.UtcNow;

            if (job.JobPauseAt.HasValue)
            {
                job.JobPausedTotalSec += (DateTime.UtcNow - job.JobPauseAt.Value).TotalSeconds;
                job.JobPauseAt = null;
            }
        }

        _context.UpdateSenderStatus();
        BroadcastStateDelta();
    }

    private void OnPause()
    {
        // Update job state if a job is running
        var job = _context.State.JobLoaded;
        if (job is not null && job.Status == "running")
        {
            job.Status = "paused";
            job.JobPauseAt = DateTime.UtcNow;
        }

        _context.UpdateSenderStatus();
        BroadcastStateDelta();
    }

    private void OnResume()
    {
        // Update job state if a job is paused
        var job = _context.State.JobLoaded;
        if (job is not null && job.Status == "paused")
        {
            if (job.JobPauseAt.HasValue)
            {
                job.JobPausedTotalSec += (DateTime.UtcNow - job.JobPauseAt.Value).TotalSeconds;
                job.JobPauseAt = null;
            }
            job.Status = "running";
        }

        _context.UpdateSenderStatus();
        BroadcastStateDelta();
    }

    private void OnUnlock()
    {
        _context.UpdateSenderStatus();
        BroadcastStateDelta();
    }
}
