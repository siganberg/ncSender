using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Infrastructure;

/// <summary>
/// A popup the operator dismisses, for something ncSender refused to do and
/// that must not go unnoticed in the console. Shown through the existing
/// plugin:show-modal channel so every client (and the kiosk) gets it.
/// It reads in three short parts: what was blocked (one small line and the
/// facts), why (the title, and the tool it is about as a card), and what to
/// do next.
/// </summary>
public static class BlockedNotice
{
    /// <summary>The thing a notice is about, drawn as a card: "T99", "Probe", a note.</summary>
    public readonly record struct Subject(string Id, string Name, string Note);

    public const string DrawbarId = "drawbar-blocked";
    public const string DrawbarWhy = "ncSender did not release the drawbar";
    public const string DrawbarTitle = "The spindle is still turning";
    public const string DrawbarLede =
        "Releasing the collet at speed can throw the tool and damage the spindle.";
    public const string DrawbarNext = "Stop the spindle, wait until it has stopped, then try again.";

    public static Task ShowAsync(IBroadcaster broadcaster, string id, string title, string lede,
        IReadOnlyList<(string Label, string Value)> details,
        string? why = null, Subject? subject = null, string? next = null) =>
        broadcaster.Broadcast("plugin:show-modal",
            new WsShowModal(id, Html(title, lede, details, why, subject, next), Closable: true),
            NcSenderJsonContext.Default.WsShowModal);

    public static Task ShowDrawbarBlockedAsync(IBroadcaster broadcaster, string command, string output) =>
        ShowAsync(broadcaster, DrawbarId, DrawbarTitle, DrawbarLede, [("Blocked", command), ("Output", output)],
            DrawbarWhy, next: DrawbarNext);

    public const string ProbeSpindleId = "probe-spindle-blocked";
    public const string SpindleWhy = "ncSender did not start the spindle";
    public const string ProbeNote = "Spinning it can break the stylus and destroy the probe and its transmitter.";
    public const string NonSpinningNote = "Spinning it can snap the tip and damage the holder.";
    public const string ProbeNext = "Load a cutting tool, then start the spindle again.";
    public const string NonSpinningNext = "Load a cutting tool, or remove M3/M4 from the program.";

    // One popup id for every non-spinning tool, so a client that already
    // handles the probe popup shows the others the same way.
    public static Task ShowSpindleBlockedAsync(IBroadcaster broadcaster, string command, int tool, string type)
    {
        var label = ToolTypes.Label(type);
        var probe = string.Equals(type, ToolTypes.Probe, StringComparison.OrdinalIgnoreCase);
        var name = label.Length > 0 ? char.ToUpperInvariant(label[0]) + label[1..] : label;
        return ShowAsync(broadcaster, ProbeSpindleId, $"A {label} is in the spindle", "",
            [("Blocked", command)],
            SpindleWhy,
            new Subject($"T{tool}", name, probe ? ProbeNote : NonSpinningNote),
            probe ? ProbeNext : NonSpinningNext);
    }

    public static string Html(string title, string lede, IReadOnlyList<(string Label, string Value)> details,
        string? why = null, Subject? subject = null, string? next = null)
    {
        static string E(string s) => System.Net.WebUtility.HtmlEncode(s);
        var rows = string.Concat(details.Select(d => $"<dt>{E(d.Label)}</dt><dd>{E(d.Value)}</dd>"));
        if (!string.IsNullOrEmpty(next)) rows += $"<dt>Do this</dt><dd class=\"bn-next\">{E(next)}</dd>";
        var whyHtml = string.IsNullOrEmpty(why) ? "" : $$"""
            <div class="bn-why">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z"/><path d="m9.5 9.5 5 5"/><path d="m14.5 9.5-5 5"/></svg>
              {{E(why)}}
            </div>
            """;
        var subjectHtml = subject is not { } sub ? "" : $$"""
            <div class="bn-subject">
              {{(sub.Id.Length > 0 ? $"<span class=\"bn-subject-id\">{E(sub.Id)}</span>" : "")}}
              <div class="bn-subject-text"><b>{{E(sub.Name)}}</b><span>{{E(sub.Note)}}</span></div>
            </div>
            """;
        return $$"""
        <style>
          .bn-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
            background: var(--color-surface);
            border-radius: var(--radius-medium);
            padding: 30px;
            width: min(560px, 92vw);
            box-sizing: border-box;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            text-align: left;
          }
          .bn-head { display: flex; flex-direction: column; gap: 4px; }
          .bn-why {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 0.95rem;
            font-weight: 600;
            color: #ff6b6b;
          }
          .bn-why svg { width: 18px; height: 18px; flex: none; }
          .bn-title { font-size: 1.55rem; font-weight: 600; line-height: 1.25; color: var(--color-text-primary); margin: 0; }
          .bn-lede { font-size: 1.05rem; line-height: 1.5; color: var(--color-text-secondary); margin: 0; }
          .bn-subject {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px 18px;
            background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
            border: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
            border-radius: var(--radius-small);
          }
          .bn-subject-id {
            flex: none;
            padding: 8px 12px;
            border-radius: 8px;
            font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
            font-size: 1.3rem;
            font-weight: 700;
            color: var(--color-text-primary);
            background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
          }
          .bn-subject-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
          .bn-subject-text b { font-size: 1.15rem; font-weight: 600; color: var(--color-text-primary); }
          .bn-subject-text span { font-size: 0.98rem; line-height: 1.4; color: var(--color-text-secondary); }
          .bn-detail {
            display: grid;
            grid-template-columns: max-content 1fr;
            column-gap: 20px;
            row-gap: 8px;
            font-size: 1rem;
            margin: 0;
          }
          .bn-detail dt { color: var(--color-text-secondary); }
          .bn-detail dd {
            margin: 0;
            font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
            color: var(--color-text-primary);
            overflow-wrap: anywhere;
          }
          .bn-detail dd.bn-next { font-family: inherit; line-height: 1.45; }
          .bn-actions {
            display: flex;
            justify-content: flex-end;
            padding-top: 20px;
            border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
          }
          .bn-close {
            min-width: 140px;
            padding: 14px 28px;
            border: none;
            border-radius: var(--radius-small);
            background: var(--color-accent);
            color: var(--color-on-accent, #fff);
            font-size: 1.05rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.15s ease;
          }
          .bn-close:hover { opacity: 0.9; }
        </style>
        <div class="bn-container">
          <div class="bn-head">
            {{whyHtml}}
            <h2 class="bn-title">{{E(title)}}</h2>
          </div>
          {{(string.IsNullOrEmpty(lede) ? "" : $"<p class=\"bn-lede\">{E(lede)}</p>")}}
          {{subjectHtml}}
          {{(rows.Length > 0 ? $"<dl class=\"bn-detail\">{rows}</dl>" : "")}}
          <div class="bn-actions">
            <button class="bn-close" onclick="parent.postMessage({ type: 'close-modal' }, '*')">OK</button>
          </div>
        </div>
        """;
    }
}
