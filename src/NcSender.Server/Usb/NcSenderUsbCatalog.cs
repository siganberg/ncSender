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

    // Fallback identification by USB iProduct string. The Arduino ESP32
    // core's variant/pins_arduino.h hard-defines USB_VID/USB_PID
    // unconditionally, so a compile-time `-DUSB_PID=...` override is
    // silently ignored — every S3 accessory ends up sharing PID 0x1001
    // regardless of what we set. USB_PRODUCT (iProduct string) DOES
    // survive that, so we key off the product string when PID matches
    // the default. Comparisons are ordinal/case-insensitive.
    private static readonly Dictionary<string, NcSenderUsbKind> KnownProductStrings =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["ncSender XProbe"]           = NcSenderUsbKind.XProbe,
            ["ncSender Wireless USB"]     = NcSenderUsbKind.WirelessDongle,
            ["ncSender Pendant"]          = NcSenderUsbKind.Pendant,
            ["ncSender AutoDustBoot"]     = NcSenderUsbKind.AutoDustBoot,
            ["ncSender RGB Controller"]   = NcSenderUsbKind.RgbController,
        };

    // Resolve the ncSender kind for a device by VID/PID first (the
    // "correct" path once firmware can advertise custom PIDs), then
    // by iProduct string as the fallback described above. Non-ncSender
    // devices always return Unknown so we never surface them.
    private static NcSenderUsbKind ResolveKind(ushort vid, ushort pid, string? productString)
    {
        if (KnownPids.TryGetValue((vid, pid), out var byPid)) return byPid;
        if (vid == NcSenderVid && !string.IsNullOrEmpty(productString)
            && KnownProductStrings.TryGetValue(productString, out var byProduct)) return byProduct;
        return NcSenderUsbKind.Unknown;
    }

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

                var serial = ReadStringAttr(usbNode, "serial");
                var product = ReadStringAttr(usbNode, "product");
                var kind = ResolveKind(vid.Value, pid.Value, product);
                if (kind == NcSenderUsbKind.Unknown) continue;
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
    // `system_profiler SPUSBDataType -json` returns an EMPTY array on
    // macOS Sequoia+ (verified on 15.x — output is literally
    // `{"SPUSBDataType":[]}` from both terminal and dotnet processes).
    // `ioreg -c IOUSBHostDevice -r -l -w 0` returns the same descriptor
    // data reliably, so that's what we parse. The output is text, tree-
    // structured by indentation, with fields like:
    //
    //   +-o ncSender Pendant@... <class IOUSBHostDevice, ...>
    //   | | | { "idVendor" = 12346  "idProduct" = 4097
    //   | | |   "USB Product Name" = "ncSender Pendant"
    //   | | |   "USB Serial Number" = "441BF685D114" ... }
    //   | | +-o AppleUSBCDCCompositeDevice <class ...>
    //   | | | ... nested serial machinery ...
    //   | | +-o IOSerialBSDClient <class ...>
    //   | |     "IOCalloutDevice" = "/dev/cu.usbmodem441BF685D1141"
    //
    // We track a stack of open USB host devices by indent depth, harvest
    // their fields, and when we see an IOCalloutDevice in a descendant,
    // attach it to the closest ancestor host device. idVendor/idProduct
    // are DECIMAL integers in ioreg (unlike system_profiler's hex).
    private IReadOnlyList<NcSenderUsbDevice> EnumerateMac()
    {
        var results = new List<NcSenderUsbDevice>();
        string? stdout;
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "/usr/sbin/ioreg",
                ArgumentList = { "-c", "IOUSBHostDevice", "-r", "-l", "-w", "0" },
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
            _logger.LogDebug(ex, "ioreg invocation failed");
            return results;
        }

        try
        {
            ParseIoregTree(stdout, results);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ioreg output parse failed");
        }
        return results;
    }

    private sealed class MacPending
    {
        public int Depth;
        public ushort Vid;
        public ushort Pid;
        public string? Product;
        public string? Serial;
        public string? CalloutDevice;
    }

    private void ParseIoregTree(string stdout, List<NcSenderUsbDevice> results)
    {
        var stack = new Stack<MacPending>();

        foreach (var rawLine in stdout.Split('\n'))
        {
            // Header line: "  | | +-o NAME@ADDR  <class CLASS, id ...>"
            var plus = rawLine.IndexOf("+-o ", StringComparison.Ordinal);
            if (plus >= 0)
            {
                int depth = plus;
                // Sibling / ancestor scopes close before we enter the new one.
                while (stack.Count > 0 && stack.Peek().Depth >= depth)
                    EmitIfMatch(stack.Pop(), results);

                var classIdx = rawLine.IndexOf("<class ", StringComparison.Ordinal);
                if (classIdx < 0) continue;
                var classStart = classIdx + "<class ".Length;
                var classEnd = rawLine.IndexOf(',', classStart);
                if (classEnd < 0) continue;
                var cls = rawLine.Substring(classStart, classEnd - classStart);
                if (cls == "IOUSBHostDevice")
                    stack.Push(new MacPending { Depth = depth });
                continue;
            }

            if (stack.Count == 0) continue;
            var top = stack.Peek();

            if (TryParseIoregInt(rawLine, "idVendor", out var vid))
                top.Vid = (ushort)vid;
            else if (TryParseIoregInt(rawLine, "idProduct", out var pid))
                top.Pid = (ushort)pid;
            else if (TryParseIoregQuoted(rawLine, "USB Product Name", out var product))
                top.Product ??= product;
            else if (TryParseIoregQuoted(rawLine, "USB Serial Number", out var serial))
                top.Serial ??= serial;
            else if (TryParseIoregQuoted(rawLine, "IOCalloutDevice", out var callout))
                top.CalloutDevice ??= callout;
        }

        while (stack.Count > 0) EmitIfMatch(stack.Pop(), results);
    }

    private void EmitIfMatch(MacPending p, List<NcSenderUsbDevice> results)
    {
        if (p.Vid == 0 || p.CalloutDevice is null) return;
        var kind = ResolveKind(p.Vid, p.Pid, p.Product);
        if (kind == NcSenderUsbKind.Unknown) return;
        results.Add(new NcSenderUsbDevice(p.CalloutDevice, kind, p.Vid, p.Pid, p.Serial, p.Product));
    }

    private static bool TryParseIoregInt(string line, string key, out int value)
    {
        value = 0;
        var idx = line.IndexOf('"' + key + "\" = ", StringComparison.Ordinal);
        if (idx < 0) return false;
        var start = idx + key.Length + 5;   // 5 = 2 quotes + " = "
        var tail = line.Substring(start).Trim();
        return int.TryParse(tail, System.Globalization.NumberStyles.Integer,
            System.Globalization.CultureInfo.InvariantCulture, out value);
    }

    private static bool TryParseIoregQuoted(string line, string key, out string value)
    {
        value = "";
        var idx = line.IndexOf('"' + key + "\" = \"", StringComparison.Ordinal);
        if (idx < 0) return false;
        var start = idx + key.Length + 6;   // 6 = 2 key-quotes + " = " + 1 value-quote
        var end = line.IndexOf('"', start);
        if (end < 0) return false;
        value = line.Substring(start, end - start);
        return true;
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

                var friendly = GetRegistryString(h, ref did, SPDRP_FRIENDLYNAME);
                var port = ParseWindowsComPort(friendly);
                if (port is null) continue;

                // The child port device's FRIENDLYNAME is Microsoft's driver
                // label ("USB Serial Device (COMN)") — not the USB iProduct
                // string we advertise. Walk to the parent USB device and read
                // its DEVPKEY_Device_BusReportedDeviceDesc, which IS the real
                // iProduct string ("ncSender Pendant", "ncSender Wireless
                // USB", etc.). Falls back to the friendly-name-based product
                // if the parent walk fails, keeping the old behaviour.
                string? product = GetWindowsParentBusReportedDeviceDesc(did.DevInst);
                if (string.IsNullOrEmpty(product) && !string.IsNullOrEmpty(friendly))
                {
                    var paren = friendly.IndexOf(" (", StringComparison.Ordinal);
                    product = paren > 0 ? friendly.Substring(0, paren) : friendly;
                }

                var kind = ResolveKind(vid, pid, product);
                if (kind == NcSenderUsbKind.Unknown) continue;
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

    // Read the USB iProduct string ("ncSender Pendant" etc.) by walking
    // from the PORTS-class child devnode up to its USB parent and asking
    // for DEVPKEY_Device_BusReportedDeviceDesc. The child devnode's own
    // friendly name / bus-reported descriptor is populated from usbser.sys
    // / TinyUSB CDC (generic strings), not our top-level iProduct.
    // Returns null on any failure so the caller falls back to friendly.
    private static string? GetWindowsParentBusReportedDeviceDesc(uint childDevInst)
    {
        try
        {
            if (CM_Get_Parent(out var parentDevInst, childDevInst, 0) != 0) return null;
            uint bufBytes = 0;
            var propKey = DEVPKEY_Device_BusReportedDeviceDesc;
            // First call sizes the buffer; expected CR_BUFFER_SMALL (26)
            _ = CM_Get_DevNode_PropertyW(parentDevInst, ref propKey, out _, null, ref bufBytes, 0);
            if (bufBytes < 2) return null;
            var buf = new byte[bufBytes];
            if (CM_Get_DevNode_PropertyW(parentDevInst, ref propKey, out var propType, buf, ref bufBytes, 0) != 0) return null;
            if (propType != DEVPROP_TYPE_STRING) return null;
            // UTF-16 with trailing NUL — trim it.
            var s = System.Text.Encoding.Unicode.GetString(buf, 0, (int)bufBytes);
            var nul = s.IndexOf('\0');
            return nul >= 0 ? s.Substring(0, nul) : s;
        }
        catch { return null; }
    }

    // ---- cfgmgr32 P/Invoke for parent walk + modern property read ----

    [StructLayout(LayoutKind.Sequential)]
    private struct DEVPROPKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    // {540b947e-8b40-45bc-a8a2-6a0b894cbda2}, 4 = BusReportedDeviceDesc.
    // Vista+; returns the raw USB iProduct string (or the equivalent for
    // other buses) as advertised by the device, not by the driver.
    private static readonly DEVPROPKEY DEVPKEY_Device_BusReportedDeviceDesc = new()
    {
        fmtid = new Guid(0x540B947E, 0x8B40, 0x45BC, 0xA8, 0xA2, 0x6A, 0x0B, 0x89, 0x4C, 0xBD, 0xA2),
        pid = 4,
    };

    private const uint DEVPROP_TYPE_STRING = 0x12;

    [DllImport("cfgmgr32.dll", SetLastError = true)]
    private static extern int CM_Get_Parent(out uint pdnDevInst, uint dnDevInst, uint ulFlags);

    [DllImport("cfgmgr32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int CM_Get_DevNode_PropertyW(
        uint dnDevInst,
        ref DEVPROPKEY propertyKey,
        out uint propertyType,
        byte[]? propertyBuffer,
        ref uint propertyBufferSize,
        uint ulFlags);
}
