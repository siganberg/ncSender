using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Job;

/// <summary>
/// Measures the loaded tool right after homing, when nothing has measured it
/// since power-up
/// (setting tlsAfterHome, off by default: the gantry moving by itself right
/// after homing must be something the operator asked for). Until something measures it, the
/// loaded program is drawn against the wrong tool length in the visualizer and
/// a Z0 kept in the controller from an earlier session is off by the whole
/// touch-off height; this puts both right before the operator does anything
/// else. Core rather than per plugin so every tool changer behaves the same,
/// and only when a tool changer provides a tool setter.
/// </summary>
public sealed class HomeToolMeasure
{
    private readonly ICncController _controller;
    private readonly ICommandProcessor _commandProcessor;
    private readonly IServerContext _context;
    private readonly ISettingsManager _settings;
    private readonly IBroadcaster _broadcaster;
    private readonly IJobManager _jobManager;
    private readonly ILogger<HomeToolMeasure> _logger;

    // Last status seen, to catch a homing cycle finishing (Home -> Idle). Any
    // home counts, not just the first since power-up: turning the setting on
    // and homing again has to measure. It still runs about once per power-up,
    // because once the tool is measured a reference exists and later homes
    // find nothing to do.
    private string _prevStatus = "";
    private int _running;

    public HomeToolMeasure(ICncController controller, ICommandProcessor commandProcessor, IServerContext context,
        ISettingsManager settings, IBroadcaster broadcaster, IJobManager jobManager, ILogger<HomeToolMeasure> logger)
    {
        _controller = controller;
        _commandProcessor = commandProcessor;
        _context = context;
        _settings = settings;
        _broadcaster = broadcaster;
        _jobManager = jobManager;
        _logger = logger;
        _controller.StatusReportReceived += OnStatusReport;
        _controller.ConnectionStatusChanged += (_, _) => _prevStatus = "";
    }

    private void OnStatusReport(MachineState status)
    {
        var prev = _prevStatus;
        _prevStatus = status.Status ?? "";
        var homingFinished = prev.StartsWith("Home", StringComparison.OrdinalIgnoreCase)
            && string.Equals(status.Status, "Idle", StringComparison.OrdinalIgnoreCase)
            && status.Homed;
        if (!homingFinished) return;

        if (!_settings.GetSetting<bool>("tlsAfterHome", false)) return;
        if (_jobManager.HasActiveJob) return;
        if (!LoadedToolMeasure.IsNeeded(_context.State.MachineState, _settings)) return;
        if (Interlocked.Exchange(ref _running, 1) == 1) return;

        var tool = _context.State.MachineState.Tool;
        _ = Task.Run(async () =>
        {
            _logger.LogInformation("Homed with T{Tool} loaded and no tool length reference: measuring it", tool);
            SetBanner(tool);
            try
            {
                await LoadedToolMeasure.SendTlsAsync(_commandProcessor, _controller, _context, "home",
                    () => _controller.IsConnected && !_jobManager.HasActiveJob);
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Measuring T{Tool} after homing failed", tool);
            }
            finally
            {
                SetBanner(0);
                Volatile.Write(ref _running, 0);
            }
        });
    }

    private void SetBanner(int tool)
    {
        _context.State.MachineState.MeasureAfterHomeTool = tool;
        _ = _broadcaster.Broadcast("server-state-updated", _context.State, NcSenderJsonContext.Default.ServerState);
    }
}
