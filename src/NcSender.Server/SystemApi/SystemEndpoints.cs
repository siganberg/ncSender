using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.SystemApi;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class SystemEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/gcode-job/status", (IServerContext context) =>
        {
            var job = context.State.JobLoaded;
            return Results.Ok(new JobStatusResponse(job is not null, job));
        });

        app.MapPost("/api/rotation", async (HttpContext context) =>
        {
            var rotationFile = "/etc/ncsender/rotation";
            var rotationScript = "/usr/local/bin/ncsender-set-rotation";

            if (context.Request.Method == "POST")
            {
                var body = await context.Request.ReadFromJsonAsync<RotationRequest>();
                if (body?.Rotation is null)
                    return Results.BadRequest(new ApiError("rotation required"));

                if (!OperatingSystem.IsLinux() || !File.Exists("/etc/ncsender/rotation"))
                    return Results.Ok(new RotationSetResponse(true, body.Rotation, "no-op on this platform"));

                try
                {
                    if (File.Exists(rotationScript))
                    {
                        var psi = new System.Diagnostics.ProcessStartInfo(rotationScript, body.Rotation)
                        {
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            UseShellExecute = false
                        };
                        var proc = System.Diagnostics.Process.Start(psi);
                        if (proc is not null)
                            await proc.WaitForExitAsync();
                    }
                    else
                    {
                        var dir = Path.GetDirectoryName(rotationFile)!;
                        Directory.CreateDirectory(dir);
                        await File.WriteAllTextAsync(rotationFile, body.Rotation);
                    }
                    return Results.Ok(new RotationSetResponse(true, body.Rotation));
                }
                catch (Exception ex)
                {
                    return Results.BadRequest(new ApiError(ex.Message));
                }
            }

            // GET rotation
            var current = File.Exists(rotationFile)
                ? (await File.ReadAllTextAsync(rotationFile)).Trim()
                : "normal";
            return Results.Ok(new RotationGetResponse(current));
        });

        app.MapGet("/api/usb-ports", () =>
        {
            try
            {
                var ports = global::System.IO.Ports.SerialPort.GetPortNames()
                    .Where(p => !SerialPortFilter.IsExcluded(p))
                    // macOS exposes every USB-serial as both /dev/cu.* (outgoing) and
                    // /dev/tty.* (incoming); only show the cu.* form — tty.* enforces
                    // POSIX terminal semantics that silently drop serial data.
                    .Where(p => !OperatingSystem.IsMacOS() || !p.StartsWith("/dev/tty.", StringComparison.Ordinal))
                    .Select(p => new SerialPortItem(p, GetSerialPortManufacturer(p)))
                    .ToArray();
                return Results.Ok(ports);
            }
            catch
            {
                return Results.Ok(Array.Empty<string>());
            }
        });

    }

    internal static string? GetSerialPortManufacturer(string portPath)
    {
        if (OperatingSystem.IsLinux()) return GetLinuxManufacturer(portPath);
        if (OperatingSystem.IsMacOS()) return GetMacOSManufacturer(portPath);
        if (OperatingSystem.IsWindows()) return GetWindowsManufacturer(portPath);
        return null;
    }

    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static string? GetWindowsManufacturer(string portPath)
    {
        // Walk HKLM\SYSTEM\CurrentControlSet\Enum\<bus>\<vidpid>\<instance>
        // looking for a child "Device Parameters" key whose PortName value
        // matches our COM port. When found, read HardwareID + Mfg +
        // DeviceDesc from the instance key. Most CNC USB-serial devices
        // register under USB (STM32, ESP32, CP210x, CH340, native CDC);
        // FTDI adapters live under FTDIBUS; a few older drivers use USBSER.
        try
        {
            using var enumKey = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum");
            if (enumKey is null) return null;

            foreach (var busName in new[] { "USB", "FTDIBUS", "USBSER" })
            {
                using var busKey = enumKey.OpenSubKey(busName);
                if (busKey is null) continue;

                foreach (var deviceClassId in busKey.GetSubKeyNames())
                {
                    using var deviceClassKey = busKey.OpenSubKey(deviceClassId);
                    if (deviceClassKey is null) continue;

                    foreach (var instanceId in deviceClassKey.GetSubKeyNames())
                    {
                        using var instanceKey = deviceClassKey.OpenSubKey(instanceId);
                        if (instanceKey is null) continue;

                        using var paramsKey = instanceKey.OpenSubKey("Device Parameters");
                        var portName = paramsKey?.GetValue("PortName") as string;
                        if (!string.Equals(portName, portPath, StringComparison.OrdinalIgnoreCase))
                            continue;

                        var mfg = CleanInfReference(instanceKey.GetValue("Mfg") as string);
                        var desc = CleanInfReference(instanceKey.GetValue("DeviceDesc") as string);
                        var hardwareIds = instanceKey.GetValue("HardwareID") as string[];

                        // When Windows uses the built-in usbser.sys CDC driver
                        // (no vendor INF installed), Mfg/DeviceDesc come back
                        // as "Microsoft / USB Serial Device" — hiding what the
                        // device's own USB descriptors say. The actual vendor
                        // is encoded in the HardwareID's VID prefix. Override
                        // the generic Microsoft strings with a known-VID lookup
                        // so users see what they expect (e.g. "STMicroelectronics
                        // STM32 Virtual COM Port" for VID_0483&PID_5740).
                        var vendorFromHwid = LookupVendorFromHardwareIds(hardwareIds);
                        if (vendorFromHwid is not null
                            && (string.IsNullOrEmpty(mfg) || mfg.Contains("Microsoft", StringComparison.OrdinalIgnoreCase)))
                        {
                            return vendorFromHwid;
                        }

                        if (!string.IsNullOrEmpty(mfg) && !string.IsNullOrEmpty(desc))
                            return $"{mfg} {desc}";
                        if (!string.IsNullOrEmpty(desc)) return desc;
                        if (!string.IsNullOrEmpty(mfg)) return mfg;
                        return vendorFromHwid;
                    }
                }
            }
        }
        catch { /* best-effort */ }
        return null;
    }

    // Map common USB VID (and a few specific VID&PID pairs) to a friendly
    // "vendor [+ product]" string. Used to override the generic Microsoft
    // CDC driver descriptors when no vendor INF is installed.
    private static readonly Dictionary<string, string> KnownUsbProducts = new(StringComparer.OrdinalIgnoreCase)
    {
        ["VID_0483&PID_5740"] = "STMicroelectronics STM32 Virtual COM Port",
        ["VID_10C4&PID_EA60"] = "Silicon Labs CP210x USB-to-UART",
        ["VID_1A86&PID_7523"] = "WCH CH340 USB-Serial",
        ["VID_1A86&PID_55D4"] = "WCH CH9102 USB-Serial",
        ["VID_0403&PID_6001"] = "FTDI FT232R USB-UART",
        ["VID_0403&PID_6014"] = "FTDI FT232H USB-UART",
        ["VID_303A&PID_1001"] = "Espressif ESP32-S2/S3",
        ["VID_303A&PID_4001"] = "Espressif ESP32-S3 (native USB)",
        ["VID_2E8A&PID_000A"] = "Raspberry Pi Pico",
        ["VID_2341&PID_0043"] = "Arduino Uno",
    };

    private static readonly Dictionary<string, string> KnownUsbVendors = new(StringComparer.OrdinalIgnoreCase)
    {
        ["VID_0483"] = "STMicroelectronics",
        ["VID_10C4"] = "Silicon Labs",
        ["VID_1A86"] = "WCH",
        ["VID_0403"] = "FTDI",
        ["VID_303A"] = "Espressif",
        ["VID_2E8A"] = "Raspberry Pi",
        ["VID_2341"] = "Arduino",
        ["VID_2A03"] = "Arduino",
        ["VID_1B4F"] = "SparkFun",
    };

    private static string? LookupVendorFromHardwareIds(string[]? hardwareIds)
    {
        if (hardwareIds is null) return null;
        foreach (var id in hardwareIds)
        {
            // HardwareID example: "USB\VID_0483&PID_5740&REV_0200"
            var vidPidMatch = System.Text.RegularExpressions.Regex.Match(
                id, @"(VID_[0-9A-Fa-f]{4})&(PID_[0-9A-Fa-f]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!vidPidMatch.Success) continue;

            var key = $"{vidPidMatch.Groups[1].Value}&{vidPidMatch.Groups[2].Value}";
            if (KnownUsbProducts.TryGetValue(key, out var product)) return product;

            if (KnownUsbVendors.TryGetValue(vidPidMatch.Groups[1].Value, out var vendor))
                return vendor;
        }
        return null;
    }

    // Windows registry sometimes stores values as INF-localized references
    // like "@oem18.inf,%vcomdesc%;STMicroelectronics Virtual COM Port".
    // The substring after the last ';' is the resolved English form.
    private static string? CleanInfReference(string? value)
    {
        if (string.IsNullOrEmpty(value)) return value;
        if (value.StartsWith('@'))
        {
            var semi = value.LastIndexOf(';');
            if (semi >= 0 && semi < value.Length - 1)
                return value[(semi + 1)..].Trim();
        }
        return value.Trim();
    }

    private static string? GetLinuxManufacturer(string portPath)
    {
        try
        {
            var ttyName = Path.GetFileName(portPath);
            var symlinkPath = $"/sys/class/tty/{ttyName}/device";
            if (!Directory.Exists(symlinkPath)) return null;

            // Resolve the real path via readlink -f
            // (.NET's ResolveLinkTarget doesn't handle relative sysfs symlinks correctly)
            var psi = new System.Diagnostics.ProcessStartInfo("readlink", $"-f {symlinkPath}")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false
            };
            using var proc = System.Diagnostics.Process.Start(psi);
            var realPath = proc?.StandardOutput.ReadToEnd().Trim();
            proc?.WaitForExit();
            if (string.IsNullOrEmpty(realPath)) return null;

            // Walk up from the resolved path to find USB device attributes
            var dir = new DirectoryInfo(realPath);
            for (var i = 0; i < 6 && dir != null; i++, dir = dir.Parent)
            {
                var productFile = Path.Combine(dir.FullName, "product");
                if (File.Exists(productFile))
                {
                    var product = File.ReadAllText(productFile).Trim();
                    var mfgFile = Path.Combine(dir.FullName, "manufacturer");
                    var manufacturer = File.Exists(mfgFile) ? File.ReadAllText(mfgFile).Trim() : null;
                    return manufacturer != null ? $"{manufacturer} {product}" : product;
                }
            }
        }
        catch { /* best-effort */ }
        return null;
    }

    private static string? GetMacOSManufacturer(string portPath)
    {
        try
        {
            // Use full ioreg tree — IOCalloutDevice is on a child node while
            // USB Product/Vendor Name are on a parent node above it.
            var psi = new System.Diagnostics.ProcessStartInfo("ioreg", "-l -w 0")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false
            };
            using var proc = System.Diagnostics.Process.Start(psi);
            var output = proc?.StandardOutput.ReadToEnd();
            proc?.WaitForExit();
            if (string.IsNullOrEmpty(output)) return null;

            var lines = output.Split('\n');

            // Find the line with IOCalloutDevice matching our port,
            // then search backwards for the nearest USB Product/Vendor Name.
            for (var i = 0; i < lines.Length; i++)
            {
                if (!lines[i].Contains("IOCalloutDevice")) continue;

                var trimmed = lines[i].AsSpan().Trim();
                var callout = ExtractIoregValue(trimmed);
                if (callout == null || !string.Equals(callout, portPath, StringComparison.Ordinal))
                    continue;

                string? vendor = null;
                string? product = null;
                for (var j = i - 1; j >= 0 && j >= i - 80; j--)
                {
                    if (product == null && lines[j].Contains("USB Product Name"))
                        product = ExtractIoregValue(lines[j].AsSpan().Trim());
                    else if (vendor == null && lines[j].Contains("USB Vendor Name"))
                        vendor = ExtractIoregValue(lines[j].AsSpan().Trim());
                    if (vendor != null && product != null) break;
                }

                if (vendor != null && product != null)
                    return $"{vendor} {product}";
                return product ?? vendor;
            }
        }
        catch { /* best-effort */ }
        return null;
    }

    private static string? ExtractIoregValue(ReadOnlySpan<char> line)
    {
        // Parse: "Key" = "Value"
        var eqIndex = line.IndexOf('=');
        if (eqIndex < 0) return null;
        var valueSpan = line[(eqIndex + 1)..].Trim();
        if (valueSpan.Length >= 2 && valueSpan[0] == '"' && valueSpan[^1] == '"')
            return valueSpan[1..^1].ToString();
        return valueSpan.ToString();
    }
}
