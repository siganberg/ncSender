namespace NcSender.Core.Interfaces;

/// <summary>
/// Server-owned blocking prompt broadcast to every connected client (browser,
/// pendant, future surfaces). The caller of <see cref="AskAsync"/> is gated
/// until any client responds; the chosen button value is returned. State
/// survives page refresh — new clients receive currently-open gates on
/// connect. With <see cref="GateOptions.Persist"/>, state also survives
/// server restart.
///
/// Use for safety-lock confirmations (homing warnings, tool-change prompts,
/// keepout intersections). Do NOT use for informational modals or toasts —
/// those stay on the plugin:show-modal path.
/// </summary>
public interface IGateService
{
    /// <summary>Open a gate and wait for a client response.</summary>
    Task<string?> AskAsync(GateOptions options, CancellationToken ct = default);

    /// <summary>Snapshot of open gates — used by WebSocket handshake to catch up new clients.</summary>
    IReadOnlyList<ActiveGate> Active();

    /// <summary>Called from WebSocketLayer when a client sends gate:respond.</summary>
    bool Resolve(string gateId, string? value);

    /// <summary>
    /// Called from WebSocketLayer when a client sends gate:step-fire. Dispatches
    /// the step's commands to the controller, increments stepProgress, rebroadcasts
    /// the updated gate. Idempotent on stale stepIndex from concurrent clients.
    /// </summary>
    Task FireStepAsync(string gateId, int stepIndex);
}

/// <summary>
/// Input to <see cref="IGateService.AskAsync"/>.
///
/// <para><b>Persist</b>: opt in to disk-backed storage. The gate reappears on
/// every client after server restart. Persisted gates outlive their original
/// caller — after restart the awaiting Task is dead, so a client response
/// clears the gate but has nothing to resume. Use only for prompts whose
/// answer doesn't need to drive a live workflow.</para>
///
/// <para><b>Key</b>: optional dedup key. Concurrent callers with the same key
/// join the same TCS instead of stacking prompts. A joiner's cancellation
/// doesn't affect the shared gate.</para>
///
/// <para><b>Steps</b>: optional walk-through of side-effect commands rendered
/// as ONE morphing button in the browser (tap = start countdown, hold =
/// immediate). Each step fires its commands through the controller without
/// closing the gate; when all steps done, buttons with
/// <see cref="GateButton.RequiresStepsComplete"/> enable. Pendant shows each
/// step as a plain full-width button (tap fires immediately).</para>
/// </summary>
public record GateOptions(
    string Title,
    string? Message = null,
    string Variant = "info",
    IReadOnlyList<GateButton>? Buttons = null,
    string? Source = null,
    bool Persist = false,
    string? Key = null,
    IReadOnlyList<GateStep>? Steps = null,
    GateStepConfig? StepConfig = null,
    bool MessageHtml = false);

/// <summary>
/// One button on a gate. <see cref="Value"/> is returned from
/// <see cref="IGateService.AskAsync"/> when this button is chosen.
/// <see cref="Style"/>: "primary" | "danger" | "secondary".
/// <see cref="RequiresStepsComplete"/>: disabled until every step has fired.
/// </summary>
public record GateButton(
    string Value,
    string Label,
    string Style = "secondary",
    bool IsDefault = false,
    bool RequiresStepsComplete = false);

/// <summary>One step of a walk-through. On tap the server dispatches Commands and increments stepProgress.</summary>
public record GateStep(string Value, string Label, IReadOnlyList<string> Commands);

/// <summary>
/// UX config for the walk-through gesture (browser only — pendant ignores).
/// HoldMs: long-press ≥ this fires immediately. CountdownSec: tap arms an
/// N-second countdown then fires. ChainSteps: after a chained fire, the
/// next step auto-arms its countdown so one gesture walks the sequence.
/// </summary>
public record GateStepConfig(int HoldMs = 1000, int CountdownSec = 5, bool ChainSteps = false);

/// <summary>Full view of an open gate, returned by <see cref="IGateService.Active"/>.</summary>
public record ActiveGate(
    string GateId,
    string Title,
    string? Message,
    string Variant,
    IReadOnlyList<GateButton> Buttons,
    string? Source,
    bool Persist = false,
    string? Key = null,
    IReadOnlyList<GateStep>? Steps = null,
    int StepProgress = 0,
    GateStepConfig? StepConfig = null,
    bool MessageHtml = false);
