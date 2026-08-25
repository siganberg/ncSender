using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.GateDialog;

/// <summary>
/// Default <see cref="IGateService"/> implementation.
///
/// In-memory registry. <see cref="AskAsync"/> assigns a guid, broadcasts
/// <c>gate:show</c>, awaits a <see cref="TaskCompletionSource{TResult}"/>
/// resolved when any client posts <c>gate:respond</c> (routed via
/// <see cref="Resolve"/>). Every terminal transition (client response, caller
/// cancel, orphan-after-rehydrate) funnels through <see cref="Complete"/> so
/// close-broadcast + disk cleanup + TCS resolution happen exactly once.
///
/// <b>Persist</b>: gates flagged persist write to <c>&lt;userData&gt;/gates.json</c>
/// and rehydrate on next boot with orphaned TCSs. On graceful shutdown, caller
/// cancellation of a persisted gate leaves the gate alive (only transient gates
/// are torn down when their caller goes away).
///
/// <b>Dedup Key</b>: concurrent callers with the same Key latch onto the same
/// pending TCS via <c>tcs.Task.WaitAsync(ct)</c>. Joiners don't register their
/// own cancellation callback — a joiner ct just abandons its wait; the primary
/// caller's cancellation controls the gate.
///
/// <b>Steps</b>: <see cref="FireStepAsync"/> dispatches step commands through
/// the controller, increments <c>stepProgress</c>, rebroadcasts <c>gate:show</c>.
/// Stale stepIndex from a slow client silently no-ops.
/// </summary>
public class GateDialogService : IGateService
{
    private readonly IBroadcaster _broadcaster;
    private readonly ICncController _controller;
    private readonly ILogger<GateDialogService> _logger;
    private readonly ConcurrentDictionary<string, PendingGate> _pending = new();
    private readonly string _persistPath;
    private readonly object _persistLock = new();

    private record PendingGate(
        ActiveGate Gate,
        TaskCompletionSource<string?> Tcs,
        CancellationTokenRegistration CtReg);

    public GateDialogService(
        IBroadcaster broadcaster,
        ICncController controller,
        ILogger<GateDialogService> logger)
    {
        _broadcaster = broadcaster;
        _controller = controller;
        _logger = logger;
        _persistPath = Path.Combine(PathUtils.GetUserDataDir(), "gates.json");
        RehydrateFromDisk();
    }

    public async Task<string?> AskAsync(GateOptions options, CancellationToken ct = default)
    {
        // Dedup: latch onto existing keyed gate.
        if (options.Key is not null)
        {
            var existing = _pending.Values.FirstOrDefault(p => p.Gate.Key == options.Key);
            if (existing is not null)
            {
                _logger.LogDebug("Gate join key={Key} gateId={GateId}", options.Key, existing.Gate.GateId);
                try { return await existing.Tcs.Task.WaitAsync(ct); }
                catch (OperationCanceledException) { return null; }
            }
        }

        var gateId = Guid.NewGuid().ToString("N");
        var buttons = options.Buttons is { Count: > 0 }
            ? options.Buttons
            : new[] { new GateButton("ok", "OK", "primary", true) };

        var gate = new ActiveGate(
            GateId: gateId,
            Title: options.Title,
            Message: options.Message,
            Variant: options.Variant,
            Buttons: buttons,
            Source: options.Source,
            Persist: options.Persist,
            Key: options.Key,
            Steps: options.Steps,
            StepProgress: 0,
            StepConfig: options.StepConfig,
            MessageHtml: options.MessageHtml);

        var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var reg = ct.Register(() => OnCallerCancelled(gateId));
        _pending[gateId] = new PendingGate(gate, tcs, reg);

        if (options.Persist) SaveToDisk();

        _logger.LogInformation(
            "Gate opened {GateId} title=\"{Title}\" source={Source} persist={Persist} key={Key} steps={Steps}",
            gateId, options.Title, options.Source ?? "core", options.Persist,
            options.Key ?? "-", options.Steps?.Count ?? 0);

        await _broadcaster.Broadcast("gate:show", ToWsShow(gate),
            NcSenderJsonContext.Default.WsGateShow);

        return await tcs.Task;
    }

    public bool Resolve(string gateId, string? value) => Complete(gateId, value);

    public IReadOnlyList<ActiveGate> Active() =>
        _pending.Values.Select(p => p.Gate).ToList();

    public async Task FireStepAsync(string gateId, int stepIndex)
    {
        if (!_pending.TryGetValue(gateId, out var pending)) return;
        var gate = pending.Gate;
        if (gate.Steps is null || gate.Steps.Count == 0) return;

        // Silently no-op stale clicks (two clients firing the same stepIndex
        // that already advanced). Only the click that matches current progress
        // counts.
        if (stepIndex != gate.StepProgress) return;
        if (stepIndex >= gate.Steps.Count) return;

        var step = gate.Steps[stepIndex];
        _logger.LogInformation("Gate {GateId} step {Idx} fire: {Value} ({Cmds} cmd)",
            gateId, stepIndex, step.Value, step.Commands.Count);

        // Dispatch commands to the controller.
        foreach (var cmd in step.Commands)
        {
            if (string.IsNullOrWhiteSpace(cmd)) continue;
            try
            {
                await _controller.SendCommandAsync(cmd, new CommandOptions
                {
                    DisplayCommand = $"{cmd} (gate:{gate.Source ?? "core"}/{step.Value})",
                    Meta = new CommandMeta { SourceId = "system", Silent = true }
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Gate {GateId} step {Idx} dispatch failed", gateId, stepIndex);
            }
        }

        var advanced = gate with { StepProgress = stepIndex + 1 };
        _pending[gateId] = pending with { Gate = advanced };

        if (advanced.Persist) SaveToDisk();

        await _broadcaster.Broadcast("gate:show", ToWsShow(advanced),
            NcSenderJsonContext.Default.WsGateShow);
    }

    /// <summary>
    /// Caller went away (its ct fired). Transient gates close everywhere;
    /// persisted gates stay alive so another client — or a fresh session
    /// after restart — can still answer. This split is critical: on graceful
    /// shutdown ASP.NET fires RequestAborted on every open HTTP request,
    /// which would otherwise sweep persisted gates off disk on the way out.
    /// </summary>
    private void OnCallerCancelled(string gateId)
    {
        if (!_pending.TryGetValue(gateId, out var pending)) return;
        if (pending.Gate.Persist)
        {
            pending.Tcs.TrySetResult(null);
            _logger.LogDebug("Gate {GateId} caller cancelled; persisted gate stays open", gateId);
        }
        else
        {
            Complete(gateId, null);
        }
    }

    /// <summary>Idempotent terminal cleanup — used for client response, cancellation, and rehydrated-orphan resolution.</summary>
    private bool Complete(string gateId, string? value)
    {
        if (!_pending.TryRemove(gateId, out var pending)) return false;
        pending.CtReg.Dispose();
        pending.Tcs.TrySetResult(value);
        if (pending.Gate.Persist) SaveToDisk();
        _ = _broadcaster.Broadcast("gate:close",
            new WsGateClose(gateId, value),
            NcSenderJsonContext.Default.WsGateClose);
        _logger.LogInformation("Gate {GateId} completed value={Value}", gateId, value ?? "(cancelled)");
        return true;
    }

    internal static WsGateShow ToWsShow(ActiveGate g)
        => new(
            GateId: g.GateId,
            Title: g.Title,
            Message: g.Message,
            Variant: g.Variant,
            Buttons: g.Buttons
                .Select(b => new WsGateButton(b.Value, b.Label, b.Style, b.IsDefault, b.RequiresStepsComplete))
                .ToList(),
            Source: g.Source,
            Steps: g.Steps?
                .Select(s => new WsGateStep(s.Value, s.Label, s.Commands.ToList()))
                .ToList(),
            StepProgress: g.StepProgress,
            StepConfig: g.StepConfig is null
                ? null
                : new WsGateStepConfig(g.StepConfig.HoldMs, g.StepConfig.CountdownSec, g.StepConfig.ChainSteps),
            MessageHtml: g.MessageHtml);

    // ── Persistence ─────────────────────────────────────────────────────────

    private void RehydrateFromDisk()
    {
        try
        {
            if (!File.Exists(_persistPath)) return;
            var json = File.ReadAllText(_persistPath);
            if (string.IsNullOrWhiteSpace(json)) return;
            var stored = JsonSerializer.Deserialize(json, GatePersistenceJsonContext.Default.ListPersistedGate);
            if (stored is null) return;

            foreach (var g in stored)
            {
                if (string.IsNullOrEmpty(g.GateId) || string.IsNullOrEmpty(g.Title)) continue;
                var buttons = (IReadOnlyList<GateButton>?)g.Buttons ?? Array.Empty<GateButton>();
                var steps = g.Steps is null ? null : (IReadOnlyList<GateStep>)g.Steps;
                var gate = new ActiveGate(
                    g.GateId, g.Title, g.Message, g.Variant ?? "info",
                    buttons, g.Source, Persist: true, Key: g.Key,
                    Steps: steps, StepProgress: g.StepProgress,
                    StepConfig: g.StepConfig, MessageHtml: g.MessageHtml);

                // Orphaned TCS — the awaiter is dead across the restart. Complete()
                // still fires close broadcast + disk cleanup on client response.
                var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
                _pending[g.GateId] = new PendingGate(gate, tcs, default);
                _logger.LogInformation("Rehydrated persisted gate {GateId}: {Title}", g.GateId, g.Title);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to rehydrate gates from {Path}; deleting so we don't loop", _persistPath);
            try { File.Delete(_persistPath); } catch { /* best effort */ }
        }
    }

    private void SaveToDisk()
    {
        lock (_persistLock)
        {
            try
            {
                var toStore = _pending.Values
                    .Where(p => p.Gate.Persist)
                    .Select(p => new PersistedGate(
                        p.Gate.GateId, p.Gate.Title, p.Gate.Message, p.Gate.Variant,
                        p.Gate.Buttons.ToList(), p.Gate.Source, p.Gate.Key,
                        p.Gate.Steps?.ToList(), p.Gate.StepProgress,
                        p.Gate.StepConfig, p.Gate.MessageHtml))
                    .ToList();

                if (toStore.Count == 0)
                {
                    if (File.Exists(_persistPath))
                    {
                        try { File.Delete(_persistPath); } catch { /* best effort */ }
                    }
                    return;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(_persistPath)!);
                var json = JsonSerializer.Serialize(toStore, GatePersistenceJsonContext.Default.ListPersistedGate);
                File.WriteAllText(_persistPath, json);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to persist gates to {Path}", _persistPath);
            }
        }
    }
}

/// <summary>Disk representation. Separate from ActiveGate so the file schema can drift independently.</summary>
internal record PersistedGate(
    string GateId,
    string Title,
    string? Message,
    string? Variant,
    List<GateButton>? Buttons,
    string? Source,
    string? Key = null,
    List<GateStep>? Steps = null,
    int StepProgress = 0,
    GateStepConfig? StepConfig = null,
    bool MessageHtml = false);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(List<PersistedGate>))]
[JsonSerializable(typeof(PersistedGate))]
[JsonSerializable(typeof(GateButton))]
[JsonSerializable(typeof(List<GateButton>))]
[JsonSerializable(typeof(GateStep))]
[JsonSerializable(typeof(List<GateStep>))]
[JsonSerializable(typeof(GateStepConfig))]
internal partial class GatePersistenceJsonContext : JsonSerializerContext;
