using NcSender.Core.Interfaces;

namespace NcSender.Server.Infrastructure;

/// <summary>
/// A popup the operator dismisses, for something ncSender refused to do and
/// that must not go unnoticed in the console: same look as the keepout
/// "Movement Blocked" dialog, shown through the existing plugin:show-modal
/// channel so every client (and the kiosk) gets it.
/// </summary>
public static class BlockedNotice
{
    public const string DrawbarId = "drawbar-blocked";
    public const string DrawbarTitle = "Drawbar Release Blocked";
    public const string DrawbarLede =
        "The spindle is turning, so the drawbar was not released. Releasing the collet at speed can throw the tool "
        + "and damage the spindle. Stop the spindle, wait until it has stopped, then try again.";

    public static Task ShowAsync(IBroadcaster broadcaster, string id, string title, string lede,
        IReadOnlyList<(string Label, string Value)> details) =>
        broadcaster.Broadcast("plugin:show-modal",
            new WsShowModal(id, Html(title, lede, details), Closable: true),
            NcSenderJsonContext.Default.WsShowModal);

    public static Task ShowDrawbarBlockedAsync(IBroadcaster broadcaster, string command, string output) =>
        ShowAsync(broadcaster, DrawbarId, DrawbarTitle, DrawbarLede, [("Command", command), ("Output", output)]);

    public static string Html(string title, string lede, IReadOnlyList<(string Label, string Value)> details)
    {
        static string E(string s) => System.Net.WebUtility.HtmlEncode(s);
        var rows = string.Concat(details.Select(d => $"<dt>{E(d.Label)}</dt><dd>{E(d.Value)}</dd>"));
        return $$"""
        <style>
          .bn-container {
            background: var(--color-surface);
            border-radius: var(--radius-medium);
            padding: 32px 36px 28px;
            max-width: 440px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            text-align: center;
          }
          .bn-icon {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            margin: 0 auto 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
            line-height: 1;
            color: var(--color-warning, #f0ad4e);
            background: color-mix(in srgb, var(--color-warning, #f0ad4e) 14%, transparent);
          }
          .bn-title { font-size: 1.25rem; font-weight: 600; color: var(--color-text-primary); margin: 0 0 10px; }
          .bn-lede { font-size: 0.95rem; line-height: 1.5; color: var(--color-text-secondary); margin: 0 0 22px; }
          .bn-detail {
            display: grid;
            grid-template-columns: max-content 1fr;
            column-gap: 20px;
            row-gap: 8px;
            text-align: left;
            font-size: 0.85rem;
            background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
            border: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
            border-radius: var(--radius-small);
            padding: 14px 18px;
            margin: 0 0 24px;
          }
          .bn-detail dt {
            color: var(--color-text-secondary);
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-weight: 600;
            align-self: center;
          }
          .bn-detail dd {
            margin: 0;
            font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
            color: var(--color-text-primary);
            word-break: break-all;
          }
          .bn-actions { display: flex; justify-content: center; }
          .bn-close {
            min-width: 140px;
            padding: 10px 24px;
            border: none;
            border-radius: var(--radius-small);
            background: var(--color-accent);
            color: var(--color-on-accent, #fff);
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.15s ease;
          }
          .bn-close:hover { opacity: 0.9; }
        </style>
        <div class="bn-container">
          <div class="bn-icon">!</div>
          <h2 class="bn-title">{{E(title)}}</h2>
          <p class="bn-lede">{{E(lede)}}</p>
          {{(details.Count > 0 ? $"<dl class=\"bn-detail\">{rows}</dl>" : "")}}
          <div class="bn-actions">
            <button class="bn-close" onclick="parent.postMessage({ type: 'close-modal' }, '*')">Dismiss</button>
          </div>
        </div>
        """;
    }
}
