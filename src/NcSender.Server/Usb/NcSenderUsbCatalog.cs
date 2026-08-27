using System.Diagnostics;
using System.IO.Ports;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.Usb;

/// <summary>
/// Cross-platform USB descriptor lookup for ncSender-branded accessories.
///
/// Every VID/PID pair we ship maps to an <see cref="NcSenderUsbKind"/>.
/// The OS-specific backend enumerates USB serial devices (with their VID,
/// PID, serial number and product string when available); we filter to
/// entries that match <see cref="KnownPids"/> and return them.
///
/// Nothing is opened. No bytes are written. This is a pure descriptor
/// read — safe to run against any USB-serial device on the host.
///
/// Backends:
///   Linux   — /sys/class/tty/&lt;name&gt;/device/../idVendor|idProduct|serial
///   macOS   — `system_profiler SPUSBDataType -json`
///   Windows — SetupAPI (GUID_DEVCLASS_PORTS + SPDRP_HARDWAREID + SPDRP_FRIENDLYNAME)
///   Other   — returns empty
///
/// Results are cached for <see cref="CacheTtlMs"/> so a scan loop
/// calling <c>GetDevices()</c> in a tight loop only pays the sysfs /
/// ioreg / SetupAPI cost once per tick.
/// </summary>
public sealed class NcSenderUsbCatalog : INcSenderUsbCatalog
{
    private const int CacheTtlMs = 1000;

    // Espressif's community-usable VID; PIDs >= 0x1000 are open for
    // custom devices. Every ncSender USB accessory sits under this VID
    // with a unique PID.
    private const ushort NcSenderVid = 0x303A;

    // The single source of truth for VID/PID → kind mapping. Adding a
    // new accessory: put its PID here, add a matching NcSenderUsbKind
    // enum value, done. Wiring lives at the consumer.
    private static readonly Dictionary<(ushort Vid, ushort Pid), NcSenderUsbKind> KnownPids =
        new()
        {
            [(NcSenderVid, 0x8210)] = NcSenderUsbKind.XProbe,
            [(NcSenderVid, 0x8211)] = NcSenderUsbKind.WirelessDongle,
            [(NcSenderVid, 0x8212)] = NcSenderUsbKind.Pendant,
            [(NcSenderVid, 0x8213)] = NcSenderUsbKind.AutoDustBoot,
            [(NcSenderVid, 0x8214)] = NcSenderUsbKind.RgbController,
        };

    private readonly ILogger<NcSenderUsbCatalog> _logger;
    private readonly object _cacheLock = new();
    private IReadOnlyList<NcSenderUsbDevice>? _cached;
    private long _cachedAtMs;

    public NcSenderUsbCatalog(ILogger<NcSenderUsbCatalog> logger)
    {
        _logger = logger;
    }

    public IReadOnlyList<NcSenderUsbDevice> GetDevices()
    {
        lock (_cacheLock)
        {
            var now = Environment.TickCount64;
            if (_cached is not null && now - _cachedAtMs < CacheTtlMs) return _cached;

            IReadOnlyList<NcSenderUsbDevice> devices;
            try
            {
                devices = Enumerate();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "NcSenderUsbCatalog enumeration threw — returning empty");
                devices = Array.Empty<NcSenderUsbDevice>();
            }

            _cached = devices;
            _cachedAtMs = now;
            return devices;
        }
    }

    private IReadOnlyList<NcSenderUsbDevice> Enumerate()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return EnumerateLinux();
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))   return EnumerateMac();
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return EnumerateWindows();
        return Array.Empty<NcSenderUsbDevice>();
    }

    // ---------- Linux ----------
    //
    // For each /dev/tty* the OS exposes, follow the sysfs symlink
    // /sys/class/tty/<basename> → the driver's directory, then walk up
    // to the USB device node which owns idVendor / idProduct / serial /
    // product files. USB serial ports live behind either the cdc_acm
    // driver (ttyACM*) or the usb_serial driver (ttyUSB*).
    private IReadOnlyList<NcSenderUsbDevice> EnumerateLinux()
    {
        var results = new List<NcSenderUsbDevice>();
        var ports = SerialPort.GetPortNames();
        foreach (var port in ports)
        {
            var basename = Path.GetFileName(port);
            if (string.IsNullOrEmpty(basename)) continue;
            var sysLink = "/sys/class/tty/" + basename;
            if (!Directory.Exists(sysLink)) continue;

            try
            {
                // /sys/class/tty/ttyACM0 -> ../../devices/.../ttyACM0
                // /sys/class/tty/ttyACM0/device -> ../../.../usbN/N-1/N-1:1.0
                // idVendor / idProduct live on the parent USB device node.
                var deviceDir = Path.Combine(sysLink, "device");
                var real = Path.GetFullPath(deviceDir);
                var usbNode = FindLinuxUsbNode(real);
                if (usbNode is null) continue;

                var vid = ReadHexAttr(usbNode, "idVendor");
                var pid = ReadHexAttr(usbNode, "idProduct");
                if (vid is null || pid is null) continue;

                if (!KnownPids.TryGetValue((vid.Value, pid.Value), out var kind)) continue;

                var serial = ReadStringAttr(usbNode, "serial");
                var product = ReadStringAttr(usbNode, "product");
                results.Add(new NcSenderUsbDevice(port, kind, vid.Value, pid.Value, serial, product));
            }
            catch (Exception ex)
            {
                _logger.LogTrace(ex, "Linux USB lookup failed for {Port}", port);
            }
        }
        return results;
    }

    private static string? FindLinuxUsbNode(string startDir)
    {
        // Walk up until we find a directory containing idVendor + idProduct
        // (the USB device node itself, not the interface / tty subnode).
        var dir = startDir;
        for (int i = 0; i < 8 && !string.IsNullOrEmpty(dir); i++)
        {
            if (File.Exists(Path.Combine(dir, "idVendor")) &&
                File.Exists(Path.Combine(dir, "idProduct"))) return dir;
            var parent = Directory.GetParent(dir)?.FullName;
            if (parent is null || parent == dir) return null;
            dir = parent;
        }
        return null;
    }

    private static ushort? ReadHexAttr(string dir, string name)
    {
        try
        {
            var path = Path.Combine(dir, name);
            if (!File.Exists(path)) return null;
            var text = File.ReadAllText(path).Trim();
            if (ushort.TryParse(text, System.Globalization.NumberStyles.HexNumber,
                    System.Globalization.CultureInfo.InvariantCulture, out var v)) return v;
        }
        catch { }
        return null;
    }

    private static string? ReadStringAttr(string dir, string name)
    {
        try
        {
            var path = Path.Combine(dir, name);
            if (!File.Exists(path)) return null;
            var text = File.ReadAllText(path).Trim();
            return string.IsNullOrEmpty(text) ? null : text;
        }
        catch { return null; }
    }

    // ---------- macOS ----------
    //
    // `system_profiler SPUSBDataType -json` returns the entire USB tree.
    // Each leaf carries vendor_id "0x303a", product_id "0x8210", serial_num,
    // _name (the product string), and — critically — _properties.location_id
    // that we don't need, plus (for CDC devices) sometimes an implicit
    // /dev/tty.usbmodemNNNN device name that we can only pattern-match by
    // walking SerialPort.GetPortNames() and matching by product_id +
    // serial_num where present. For our devices (ESP32 native USB CDC),
    // the OS names the port /dev/tty.usbmodem<serial>.
    private IReadOnlyList<NcSenderUsbDevice> EnumerateMac()
    {
        var results = new List<NcSenderUsbDevice>();
        string? stdout;
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "/usr/sbin/system_profiler",
                ArgumentList = { "SPUSBDataType", "-json" },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc is null) return results;
            stdout = proc.StandardOutput.ReadToEnd();
            if (!proc.WaitForExit(3000)) { try { proc.Kill(); } catch { } return results; }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "system_profiler invocation failed");
            return results;
        }

        List<(ushort Vid, ushort Pid, string? Serial, string? Product)> matches;
        try
        {
            matches = ExtractMacUsbMatches(stdout);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "system_profiler JSON parse failed");
            return results;
        }
        if (matches.Count == 0) return results;

        var ports = SerialPort.GetPortNames();
        foreach (var m in matches)
        {
            if (!KnownPids.TryGetValue((m.Vid, m.Pid), out var kind)) continue;
            var port = ResolveMacPort(ports, m.Serial);
            if (port is null) continue;
            results.Add(new NcSenderUsbDevice(port, kind, m.Vid, m.Pid, m.Serial, m.Product));
        }
        return results;
    }

    private static List<(ushort Vid, ushort Pid, string? Serial, string? Product)> ExtractMacUsbMatches(string json)
    {
        var found = new List<(ushort, ushort, string?, string?)>();
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("SPUSBDataType", out var root)) return found;
        WalkMacUsbTree(root, found);
        return found;

        static void WalkMacUsbTree(JsonElement node, List<(ushort, ushort, string?, string?)> acc)
        {
            if (node.ValueKind == JsonValueKind.Array)
            {
                foreach (var child in node.EnumerateArray()) WalkMacUsbTree(child, acc);
                return;
            }
            if (node.ValueKind != JsonValueKind.Object) return;

            // Recurse first — hubs contain child items under "_items".
            if (node.TryGetProperty("_items", out var items)) WalkMacUsbTree(items, acc);

            if (!node.TryGetProperty("vendor_id", out var vidEl)) return;
            if (!node.TryGetProperty("product_id", out var pidEl)) return;

            var vid = ParseMacHex(vidEl.GetString());
            var pid = ParseMacHex(pidEl.GetString());
            if (vid is null || pid is null) return;

            string? serial = null;
            if (node.TryGetProperty("serial_num", out var sEl)) serial = sEl.GetString();

            string? product = null;
            if (node.TryGetProperty("_name", out var pEl)) product = pEl.GetString();

            acc.Add((vid.Value, pid.Value, serial, product));
        }
    }

    private static ushort? ParseMacHex(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        // system_profiler writes vendor_id like "0x303a  (Espressif Systems)" —
        // trim any suffix and strip 0x.
        var s = raw.Trim();
        var space = s.IndexOf(' ');
        if (space > 0) s = s.Substring(0, space);
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) s = s.Substring(2);
        if (ushort.TryParse(s, System.Globalization.NumberStyles.HexNumber,
                System.Globalization.CultureInfo.InvariantCulture, out var v)) return v;
        return null;
    }

    private static string? ResolveMacPort(string[] ports, string? serial)
    {
        // ESP32 native USB CDC surfaces as /dev/tty.usbmodem<serial>N where
        // <serial> is the descriptor iSerialNumber. Match by serial suffix
        // when we know the serial; fall back to any lone usbmodem port
        // (best-effort — collisions are rare because we only get here for
        // matched VID/PIDs).
        if (!string.IsNullOrEmpty(serial))
        {
            foreach (var p in ports)
            {
                if (p.Contains(serial, StringComparison.Ordinal) &&
                    p.StartsWith("/dev/tty.", StringComparison.Ordinal))
                    return p;
            }
        }
        foreach (var p in ports)
        {
            if (p.StartsWith("/dev/tty.usbmodem", StringComparison.Ordinal)) return p;
        }
        return null;
    }

    // ---------- Windows ----------
    //
    // SetupAPI: enumerate the PORTS class, read SPDRP_HARDWAREID
    // (contains "USB\VID_303A&PID_8210\<serial>"), and SPDRP_FRIENDLYNAME
    // (contains "(COMN)"). Everything AOT-safe: pure P/Invoke, no COM,
    // no System.Management.
    private IReadOnlyList<NcSenderUsbDevice> EnumerateWindows()
    {
        var results = new List<NcSenderUsbDevice>();
        var portsClass = new Guid("4D36E978-E325-11CE-BFC1-08002BE10318");  // GUID_DEVCLASS_PORTS
        IntPtr h = SetupDiGetClassDevs(ref portsClass, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) return results;

        try
        {
            var did = new SP_DEVINFO_DATA();
            did.cbSize = (uint)Marshal.SizeOf<SP_DEVINFO_DATA>();
            for (uint idx = 0; SetupDiEnumDeviceInfo(h, idx, ref did); idx++)
            {
                var hwid = GetRegistryString(h, ref did, SPDRP_HARDWAREID);
                if (string.IsNullOrEmpty(hwid)) continue;
                if (!TryParseWindowsHardwareId(hwid, out var vid, out var pid, out var serial)) continue;
                if (!KnownPids.TryGetValue((vid, pid), out var kind)) continue;

                var friendly = GetRegistryString(h, ref did, SPDRP_FRIENDLYNAME);
                var port = ParseWindowsComPort(friendly);
                if (port is null) continue;

                string? product = null;
                if (!string.IsNullOrEmpty(friendly))
                {
                    // "USB Serial Device (COM5)" -> "USB Serial Device"
                    var paren = friendly.IndexOf(" (", StringComparison.Ordinal);
                    if (paren > 0) product = friendly.Substring(0, paren);
                    else product = friendly;
                }

                results.Add(new NcSenderUsbDevice(port, kind, vid, pid, serial, product));
            }
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(h);
        }
        return results;
    }

    private static bool TryParseWindowsHardwareId(string hwid, out ushort vid, out ushort pid, out string? serial)
    {
        vid = 0; pid = 0; serial = null;
        // A multi-string; typical entry: "USB\VID_303A&PID_8210&REV_0100" or "USB\VID_303A&PID_8210"
        // Split on NUL first; entries can also be separated by \r\n depending on how we read it.
        var raw = hwid.Replace('\0', '\n');
        foreach (var line in raw.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var vIdx = line.IndexOf("VID_", StringComparison.OrdinalIgnoreCase);
            var pIdx = line.IndexOf("PID_", StringComparison.OrdinalIgnoreCase);
            if (vIdx < 0 || pIdx < 0) continue;
            var vHex = SafeSubstring(line, vIdx + 4, 4);
            var pHex = SafeSubstring(line, pIdx + 4, 4);
            if (!ushort.TryParse(vHex, System.Globalization.NumberStyles.HexNumber,
                    System.Globalization.CultureInfo.InvariantCulture, out vid)) continue;
            if (!ushort.TryParse(pHex, System.Globalization.NumberStyles.HexNumber,
                    System.Globalization.CultureInfo.InvariantCulture, out pid)) continue;
            return true;
        }
        return false;
    }

    private static string? SafeSubstring(string s, int start, int len)
    {
        if (start < 0 || start + len > s.Length) return null;
        return s.Substring(start, len);
    }

    private static string? ParseWindowsComPort(string? friendly)
    {
        if (string.IsNullOrEmpty(friendly)) return null;
        // "USB Serial Device (COM5)"
        var open = friendly.LastIndexOf('(');
        var close = friendly.LastIndexOf(')');
        if (open < 0 || close < 0 || close <= open) return null;
        var inner = friendly.Substring(open + 1, close - open - 1);
        if (inner.StartsWith("COM", StringComparison.OrdinalIgnoreCase)) return inner;
        return null;
    }

    // ---- SetupAPI P/Invoke ----

    private const int DIGCF_PRESENT = 0x2;
    private const uint SPDRP_HARDWAREID = 0x00000001;
    private const uint SPDRP_FRIENDLYNAME = 0x0000000C;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVINFO_DATA
    {
        public uint cbSize;
        public Guid ClassGuid;
        public uint DevInst;
        public IntPtr Reserved;
    }

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr SetupDiGetClassDevs(ref Guid ClassGuid, IntPtr Enumerator, IntPtr hwndParent, int Flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInfo(IntPtr DeviceInfoSet, uint MemberIndex, ref SP_DEVINFO_DATA DeviceInfoData);

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetupDiGetDeviceRegistryProperty(
        IntPtr DeviceInfoSet,
        ref SP_DEVINFO_DATA DeviceInfoData,
        uint Property,
        out uint PropertyRegDataType,
        IntPtr PropertyBuffer,
        uint PropertyBufferSize,
        out uint RequiredSize);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr DeviceInfoSet);

    private static string? GetRegistryString(IntPtr h, ref SP_DEVINFO_DATA did, uint property)
    {
        uint required = 0;
        _ = SetupDiGetDeviceRegistryProperty(h, ref did, property, out _, IntPtr.Zero, 0, out required);
        if (required == 0) return null;
        var buf = Marshal.AllocHGlobal((int)required);
        try
        {
            if (!SetupDiGetDeviceRegistryProperty(h, ref did, property, out _, buf, required, out _)) return null;
            return Marshal.PtrToStringUni(buf);
        }
        finally { Marshal.FreeHGlobal(buf); }
    }
}
