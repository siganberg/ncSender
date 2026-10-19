namespace NcSender.Server.Dongle;

/// <summary>
/// Battery level from a device heartbeat, "&lt;state&gt;:H:&lt;seq&gt;:B&lt;mV&gt;:&lt;src&gt;"
/// (the nc3DAir probe). "BC&lt;mV&gt;" is the cell voltage while the cable is in
/// and charging; "BU" is a cable with no cell reading (older firmware, the
/// Super Mini build). A heartbeat with no B field has not measured yet and
/// changes nothing.
///
/// The firmware measures every 30 s and a single ADC sample is noisy (one
/// read 3.13 V on a 3.65 V cell), so the level shown is the median of the
/// last few measurements, not the latest one.
/// </summary>
public sealed class BatteryReading
{
    private const int Window = 5;
    // Heartbeats repeat the last measurement several times a second; one
    // sample per firmware measurement is what the median should see.
    private const long SampleIntervalMs = 25_000;
    public const int LowMv = 3500;
    // There is no charge-complete signal (the charger's CHRG pin is not wired),
    // so a charging cell this high is called full.
    public const int FullMv = 4150;

    private readonly List<int> _samples = new(Window);
    private string? _lastToken;
    private long _lastSampleTicks;

    /// <summary>On a cable with no cell reading ("BU").</summary>
    public bool OnUsb { get; private set; }

    /// <summary>
    /// Charging ("BC"). The voltage reads 0.1-0.2 V high while current flows,
    /// so these samples are kept apart from battery ones: the median starts
    /// over whenever the kind of reading changes.
    /// </summary>
    public bool Charging { get; private set; }

    /// <summary>Smoothed cell voltage, or null when nothing has been measured.</summary>
    public int? Millivolts => _samples.Count == 0 ? null : Median();

    /// <summary>Feeds one payload. True when what <see cref="Millivolts"/> or <see cref="OnUsb"/> report changed.</summary>
    public bool Observe(string payload, long nowTicks)
    {
        var token = Token(payload);
        if (token is null) return false;
        var before = (Millivolts, OnUsb, Charging);

        if (token == "U")
        {
            OnUsb = true;
            Charging = false;
            _samples.Clear();
        }
        else if (int.TryParse(token.StartsWith('C') ? token[1..] : token, out var mv) && mv is > 2000 and < 5000)
        {
            var charging = token.StartsWith('C');
            if (OnUsb || charging != Charging) _samples.Clear();
            OnUsb = false;
            Charging = charging;
            if (_samples.Count == 0 || token != _lastToken || nowTicks - _lastSampleTicks >= SampleIntervalMs)
            {
                if (_samples.Count == Window) _samples.RemoveAt(0);
                _samples.Add(mv);
                _lastSampleTicks = nowTicks;
            }
        }
        _lastToken = token;
        return before != (Millivolts, OnUsb, Charging);
    }

    public void Clear()
    {
        _samples.Clear();
        _lastToken = null;
        OnUsb = false;
        Charging = false;
    }

    // The second-to-last ':' field of a heartbeat, without its 'B'.
    internal static string? Token(string payload)
    {
        var fields = payload.Trim().Split(':');
        if (fields.Length < 5 || fields[1] != "H") return null;
        var b = fields[^2];
        return b.Length > 1 && b[0] == 'B' ? b[1..] : null;
    }

    private int Median()
    {
        var sorted = _samples.Order().ToArray();
        var mid = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    // Single-cell LiPo under light load, roughly: 4.20 V full, 3.30 V empty.
    private static readonly (int Mv, int Percent)[] Curve =
    [
        (3300, 0), (3500, 5), (3600, 12), (3650, 20), (3700, 30), (3750, 40),
        (3800, 50), (3900, 65), (4000, 80), (4100, 90), (4200, 100),
    ];

    public static int Percent(int mv)
    {
        if (mv <= Curve[0].Mv) return 0;
        if (mv >= Curve[^1].Mv) return 100;
        for (var i = 1; i < Curve.Length; i++)
        {
            var (hiMv, hiP) = Curve[i];
            if (mv > hiMv) continue;
            var (loMv, loP) = Curve[i - 1];
            return loP + (int)Math.Round((double)(mv - loMv) * (hiP - loP) / (hiMv - loMv));
        }
        return 100;
    }
}
