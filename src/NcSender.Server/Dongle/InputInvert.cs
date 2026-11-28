using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json.Nodes;
using NcSender.Core.Interfaces;

namespace NcSender.Server.Dongle;

/// <summary>
/// Per-input "Invert" for an accessory whose firmware reports raw input
/// states and has no polarity setting of its own (the Wireless I/O). The
/// setting lives in ncSender, one bit per input, and is applied to what the
/// device reports as the line comes in, so everything downstream (the
/// Accessories view, plugins, DONGLE_WAIT) reads the corrected state.
/// </summary>
public sealed class InputInvertStore
{
    private const string KeyPrefix = "accessories.inputInvert.";

    private readonly ISettingsManager _settings;
    private readonly ConcurrentDictionary<string, int> _cache = new(StringComparer.OrdinalIgnoreCase);

    public InputInvertStore(ISettingsManager settings)
    {
        _settings = settings;
        _settings.SettingsSaved += _ => _cache.Clear();
    }

    /// <summary>Bit n set = input n (0-based, the device's "in&lt;n&gt;") is inverted.</summary>
    public int Mask(string device) =>
        _cache.GetOrAdd(device, d => _settings.GetSetting<int>(KeyPrefix + d.ToLowerInvariant(), 0));

    public async Task SetAsync(string device, int index, bool inverted)
    {
        var mask = Mask(device);
        mask = inverted ? mask | (1 << index) : mask & ~(1 << index);
        var patch = new JsonObject
        {
            ["accessories"] = new JsonObject
            {
                ["inputInvert"] = new JsonObject { [device.ToLowerInvariant()] = mask }
            }
        };
        await _settings.SaveSettings(patch).ConfigureAwait(false);
        _cache[device] = mask;
    }
}

public static class InputInvert
{
    /// <summary>
    /// Flip the inverted inputs in a reported line: the "in=&lt;hex&gt;" mask, each
    /// "in&lt;n&gt;=&lt;0|1&gt;" field, and the value of an "in &lt;n&gt; &lt;0|1&gt;" event. Anything
    /// else (answers to a command, other fields) is returned untouched.
    /// </summary>
    public static string Apply(string payload, int mask)
    {
        if (mask == 0) return payload;
        var isEvent = payload.StartsWith("in ", StringComparison.Ordinal);
        if (!isEvent && !payload.StartsWith("status ", StringComparison.Ordinal)) return payload;

        var parts = payload.Split(' ');
        if (isEvent && parts.Length >= 3
            && int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var n)
            && n < 31 && (mask & (1 << n)) != 0 && parts[2] is "0" or "1")
        {
            parts[2] = parts[2] == "0" ? "1" : "0";
        }

        for (var i = 1; i < parts.Length; i++)
        {
            var p = parts[i];
            if (!p.StartsWith("in", StringComparison.Ordinal)) continue;
            var eq = p.IndexOf('=');
            if (eq < 0) continue;
            var value = p[(eq + 1)..];
            if (eq == 2)
            {
                // in=<hex>: bit n is input n.
                if (value.Length is > 0 and <= 7
                    && int.TryParse(value, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var bits))
                {
                    var width = (1 << (4 * value.Length)) - 1;
                    parts[i] = "in=" + ((bits ^ mask) & width).ToString("x" + value.Length, CultureInfo.InvariantCulture);
                }
            }
            else if (int.TryParse(p.AsSpan(2, eq - 2), NumberStyles.None, CultureInfo.InvariantCulture, out var idx)
                     && idx < 31 && (mask & (1 << idx)) != 0 && value is "0" or "1")
            {
                parts[i] = p[..(eq + 1)] + (value == "0" ? "1" : "0");
            }
        }
        return string.Join(' ', parts);
    }

    /// <summary>
    /// The inputs a status line reports, in order: "… in0=0 in1=1 …" gives
    /// [false, true]. Null when the line has none.
    /// </summary>
    public static List<bool>? ReadStates(string? status)
    {
        if (string.IsNullOrEmpty(status)) return null;
        var states = new List<bool>();
        while (DongleDeviceService.TryReadField(status, "in" + states.Count.ToString(CultureInfo.InvariantCulture), out var v))
            states.Add(v != 0);
        return states.Count == 0 ? null : states;
    }
}
