using NcSender.Core.Interfaces;

namespace NcSender.Server.Tools;

/// <summary>
/// Settings → Tool Changer → Tool Numbering: what the T in M6 T&lt;n&gt; names.
/// <list type="bullet">
/// <item><b>Slot</b> (classic, the default): T&lt;n&gt; is magazine slot n. Each slot
/// uses the tool the Tool Library puts in it (its name and lengths) or a plain
/// "Tool n"; anything past the magazine is a manual change, offered by the
/// Manual button as T&lt;size + 1&gt;.</item>
/// <item><b>Tool ID</b>: T&lt;n&gt; is the tool with Tool ID n, wherever it sits.</item>
/// </list>
/// </summary>
public static class ToolNumbering
{
    public const string Setting = "tool.numbering";
    public const string Slot = "slot";
    public const string ToolId = "toolId";

    public static bool IsSlot(ISettingsManager settings) =>
        settings.GetSetting<string>(Setting, Slot) != ToolId;

    /// <summary>
    /// The Manual button (T&lt;size + 1&gt;): Slot numbering only, and only when
    /// there is a tool changer to handle it (a plugin, or a magazine).
    /// </summary>
    public static bool OffersManualTool(ISettingsManager settings) =>
        IsSlot(settings)
        && (!string.IsNullOrEmpty(settings.GetSetting<string>("tool.source", null))
            || settings.GetSetting<int>("tool.count", 0) > 0);
}
