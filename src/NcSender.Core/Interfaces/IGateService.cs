namespace NcSender.Core.Interfaces;

/// <summary>
/// Server-owned blocking prompt broadcast to every connected client.
/// The workflow that calls <see cref="AskAsync"/> is gated until any client
/// responds; the chosen button value is returned. State survives page refresh
/// — a fresh client receives the currently-active gates on connect.
///
/// Use for safety-lock confirmations: homing into a keepout zone, running an
/// unhomed job, aborting mid-tool-change. Do NOT use for informational modals,
/// settings panels, or toast notifications — those stay on the plugin:show-modal
/// path.
/// </summary>
public interface IGateService
{
    /// <summary>
    /// Show a gate to every client and wait for a response.
    /// Returns the chosen button value, or <c>null</c> if cancelled via <paramref name="ct"/>.
    /// </summary>
    Task<string?> AskAsync(GateOptions options, CancellationToken ct = default);

    /// <summary>
    /// Snapshot of currently-open gates. Used by the WebSocket layer to
    /// catch up a freshly-connected client via gate:active.
    /// </summary>
    IReadOnlyList<ActiveGate> Active();

    /// <summary>
    /// Called by the WebSocket layer when a client sends gate:respond.
    /// Resolves the awaiting <see cref="AskAsync"/> task with the chosen value.
    /// </summary>
    bool Resolve(string gateId, string? value);
}

/// <summary>
/// Input to <see cref="IGateService.AskAsync"/>. Buttons default to a single
/// primary OK; supply <see cref="Buttons"/> for anything else.
///
/// <para><see cref="Persist"/>: opt in to disk-backed storage so the gate
/// survives a server restart. On next boot the gate reappears on every client
/// and can be answered. Persisted gates outlive their original caller — the
/// awaiting <see cref="IGateService.AskAsync"/> Task is dead after restart —
/// so persist only for prompts whose *answer* doesn't need to resume a live
/// workflow (safety acknowledgments, "verify state before continuing" gates,
/// standalone notifications). For gates that gate an in-flight step (tool
/// change confirmation mid-job), leave <see cref="Persist"/> false — the step
/// itself is dead on restart, so re-showing its prompt would be confusing.</para>
/// </summary>
public record GateOptions(
    string Title,
    string? Message = null,
    string Variant = "info",
    IReadOnlyList<GateButton>? Buttons = null,
    string? Source = null,
    bool Persist = false,
    string? Key = null);

/// <summary>
/// One button on a gate. <see cref="Value"/> is what <see cref="IGateService.AskAsync"/>
/// returns when this button is chosen; <see cref="Style"/> is a UI hint
/// ("primary" | "danger" | "secondary").
/// </summary>
public record GateButton(
    string Value,
    string Label,
    string Style = "secondary",
    bool IsDefault = false);

/// <summary>
/// Full description of a currently-open gate, as returned by
/// <see cref="IGateService.Active"/>. <see cref="Persist"/> reflects whether
/// this gate was opened with <see cref="GateOptions.Persist"/>, used by the
/// service to know whether to write/remove it from the on-disk store.
/// </summary>
public record ActiveGate(
    string GateId,
    string Title,
    string? Message,
    string Variant,
    IReadOnlyList<GateButton> Buttons,
    string? Source,
    bool Persist = false,
    string? Key = null);
