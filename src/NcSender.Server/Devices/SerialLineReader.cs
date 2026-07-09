using System.IO.Ports;
using System.Text;

namespace NcSender.Server.Devices;

/// <summary>
/// Reads newline-terminated lines from a <see cref="SerialPort"/> in a way
/// that's tolerant of the binary chunks the OTA flow interleaves with them.
///
/// During an OTA the same port carries both the raw firmware bytes we're
/// writing AND small ACK / PROGRESS lines the board writes back. The bytes
/// we send are one-way (device only reads). The bytes the device sends are
/// only ever ASCII lines. So a plain "read one byte at a time, buffer until
/// \n" loop is safe.
/// </summary>
internal sealed class SerialLineReader
{
    private readonly SerialPort _port;
    private readonly StringBuilder _buf = new();

    public SerialLineReader(SerialPort port) { _port = port; }

    /// <summary>Wait for a specific line (exact match). Discards other lines.</summary>
    public Task<bool> WaitForAsync(string expected, TimeSpan timeout, CancellationToken ct)
        => WaitForAnyAsync(new[] { expected }, timeout, ct, allowProgress: false);

    /// <summary>Wait for any of the given lines. Progress / message lines from
    /// the board are ignored if <paramref name="allowProgress"/> is true.</summary>
    public async Task<bool> WaitForAnyAsync(IEnumerable<string> expected, TimeSpan timeout,
        CancellationToken ct, bool allowProgress)
    {
        var deadline = DateTime.UtcNow + timeout;
        var wanted = new HashSet<string>(expected);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            var line = TryReadLine();
            if (line is null)
            {
                await Task.Delay(5, ct);
                continue;
            }
            if (wanted.Contains(line)) return true;
            if (allowProgress && (line.StartsWith("$OTA:PROGRESS:") || line.StartsWith("$OTA:ACK"))) continue;
            if (line.StartsWith("$OTA:ERROR:"))
                throw new IOException(line[11..]);
            // Other chatter — ignore and keep waiting
        }
        return false;
    }

    private string? TryReadLine()
    {
        try
        {
            var stream = _port.BaseStream;
            while (stream.CanRead)
            {
                int b;
                try { b = stream.ReadByte(); }
                catch (TimeoutException) { break; }
                if (b < 0) break;
                if (b == '\n' || b == '\r')
                {
                    if (_buf.Length == 0) continue;
                    var s = _buf.ToString();
                    _buf.Clear();
                    return s;
                }
                _buf.Append((char)b);
            }
        }
        catch (TimeoutException)
        {
            // no data yet
        }
        return null;
    }
}
