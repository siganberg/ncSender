using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.GateDialog;

/// <summary>
/// Default implementation of <see cref="IGateService"/>.
///
/// Holds an in-memory registry of open gates. On <see cref="AskAsync"/>: assigns
/// a guid, broadcasts <c>gate:show</c> to every client, awaits a
/// <see cref="TaskCompletionSource{TResult}"/> that resolves when the first
/// client posts <c>gate:respond</c> (dispatched through <see cref="Resolve"/> by
/// the WebSocket layer). On resolution, broadcasts <c>gate:close</c> so all
/// other clients close in sync.
///
/// <para><b>Persistence.</b> When <see cref="GateOptions.Persist"/> is true the
/// gate is written to <c>&lt;userData&gt;/gates.json</c> on open and removed on
/// close. On startup the file is loaded and every persisted gate is rehydrated
/// into <see cref="_pending"/> with an orphaned TCS (nothing awaits it — the
/// caller's continuation died with the previous process). A client response
/// after rehydration still routes through the same <see cref="Complete"/> path:
/// gate:close broadcasts, disk clears, all clients dismiss. Fire-and-forget on
/// the awaiting side, but visually and on-the-wire indistinguishable from a
/// live-caller gate to every client.</para>
///
/// <para>Transient (non-persisted) gates behave exactly as before: state lives
/// only in memory and dies with the process.</para>
/// </summary>
public class GateDialogService : IGateService
{
    private readonly IBroadcaster _broadcaster;
    private readonly ILogger<GateDialogService> _logger;
    private readonly ConcurrentDictionary<string, PendingGate> _pending = new();
    private readonly string _persistPath;
    private readonly object _persistLock = new();

    private record PendingGate(
        ActiveGate Gate,
        TaskCompletionSource<string?> Tcs,
        CancellationTokenRegistration CtReg);

    public GateDialogService(IBroadcaster broadcaster, ILogger<GateDialogService> logger)
    {
        _broadcaster = broadcaster;
        _logger = logger;
        _persistPath = Path.Combine(PathUtils.GetUserDataDir(), "gates.json");
        RehydrateFromDisk();
    }

    public async Task<string?> AskAsync(GateOptions options, CancellationToken ct = default)
    {
        // Dedup: if another caller already opened a gate with the same key,
        // join its TCS. Joiners never register their own OnCallerCancelled —
        // a joiner's ct just abandons its wait; only the *original* caller's
        // cancellation can affect the shared gate, and even that leaves
        // persisted gates alive for other clients to answer.
        if (options.Key is not null)
        {
            var existing = _pending.Values.FirstOrDefault(p => p.Gate.Key == options.Key);
            if (existing is not null)
            {
                _logger.LogDebug("Gate join: caller latching onto existing key={Key} gateId={GateId}",
                    options.Key, existing.Gate.GateId);
                try { return await existing.Tcs.Task.WaitAsync(ct); }
                catch (OperationCanceledException) { return null; }
            }
        }

        var gateId = Guid.NewGuid().ToString("N");
        var buttons = options.Buttons is { Count: > 0 }
            ? options.Buttons
            : new[] { new GateButton("ok", "OK", "primary", true) };

        var gate = new ActiveGate(
            gateId,
            options.Title,
            options.Message,
            options.Variant,
            buttons,
            options.Source,
            options.Persist,
            options.Key);

        var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var reg = ct.Register(() => OnCallerCancelled(gateId));
        _pending[gateId] = new PendingGate(gate, tcs, reg);

        if (options.Persist) SaveToDisk();

        _logger.LogInformation("Gate {GateId} opened: {Title} (source={Source}, persist={Persist}, key={Key})",
            gateId, options.Title, options.Source ?? "core", options.Persist, options.Key ?? "-");

        await _broadcaster.Broadcast("gate:show", ToWsShow(gate),
            NcSenderJsonContext.Default.WsGateShow);

        return await tcs.Task;
    }

    /// <summary>
    /// Route a client's <c>gate:respond</c> into the pending gate. Delegates to
    /// <see cref="Complete"/> — the caller (if any) resolves; disk clears; every
    /// client receives <c>gate:close</c>.
    /// </summary>
    public bool Resolve(string gateId, string? value) => Complete(gateId, value);

    public IReadOnlyList<ActiveGate> Active()
    {
        return _pending.Values.Select(p => p.Gate).ToList();
    }

    /// <summary>
    /// Caller (the awaiting <see cref="AskAsync"/>) went away — its
    /// CancellationToken fired. For a transient gate, close everywhere:
    /// nobody's left to receive the answer, so leaving it up wastes user
    /// attention. For a persisted gate, keep the gate alive on every client
    /// (and on disk) so any client — or a fresh session after server restart —
    /// can still answer; just release the awaiter with a null result so
    /// <c>AskAsync</c> can return.
    ///
    /// Critical for restart-survival: ASP.NET fires RequestAborted on every
    /// in-flight HTTP request during graceful shutdown. Without this split,
    /// a persisted gate opened by an HTTP endpoint would be swept from disk
    /// as the server exited, defeating the whole point of Persist.
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

    /// <summary>
    /// Single cleanup path for every terminal transition: a client response,
    /// a transient-gate caller cancellation, or (on the rehydrated-orphan case)
    /// a client response to a gate whose original awaiter is long dead.
    /// Idempotent — second call for the same id is a no-op.
    /// </summary>
    private bool Complete(string gateId, string? value)
    {
        if (!_pending.TryRemove(gateId, out var pending)) return false;

        pending.CtReg.Dispose();
        pending.Tcs.TrySetResult(value);   // no-op for orphaned TCS; resumes the awaiter otherwise.

        if (pending.Gate.Persist) SaveToDisk();

        _ = _broadcaster.Broadcast("gate:close",
            new WsGateClose(gateId, value),
            NcSenderJsonContext.Default.WsGateClose);

        _logger.LogInformation("Gate {GateId} completed with value {Value}",
            gateId, value ?? "(cancelled)");
        return true;
    }

    internal static WsGateShow ToWsShow(ActiveGate g)
        => new(
            g.GateId,
            g.Title,
            g.Message,
            g.Variant,
            g.Buttons.Select(b => new WsGateButton(b.Value, b.Label, b.Style, b.IsDefault)).ToList(),
            g.Source);

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
                var gate = new ActiveGate(
                    g.GateId, g.Title, g.Message, g.Variant ?? "info",
                    (IReadOnlyList<GateButton>?)g.Buttons ?? Array.Empty<GateButton>(),
                    g.Source,
                    Persist: true,
                    Key: g.Key);

                // Orphaned TCS: nothing is awaiting this. Complete() still fires
                // the close broadcast + disk cleanup when a client responds.
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
                        p.Gate.Buttons.ToList(), p.Gate.Source, p.Gate.Key))
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

/// <summary>
/// On-disk shape of a persisted gate. Kept separate from <see cref="ActiveGate"/>
/// so the wire/domain type can evolve independently from the file format.
/// </summary>
internal record PersistedGate(
    string GateId,
    string Title,
    string? Message,
    string? Variant,
    List<GateButton>? Buttons,
    string? Source,
    string? Key = null);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(List<PersistedGate>))]
[JsonSerializable(typeof(PersistedGate))]
[JsonSerializable(typeof(GateButton))]
[JsonSerializable(typeof(List<GateButton>))]
internal partial class GatePersistenceJsonContext : JsonSerializerContext;
