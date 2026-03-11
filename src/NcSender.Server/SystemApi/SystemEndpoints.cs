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
                    .Where(p => !p.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase)
                             && !p.Contains("WLAN", StringComparison.OrdinalIgnoreCase)
                             && !p.Contains("WiFi", StringComparison.OrdinalIgnoreCase)
                             && !p.Contains("debug-console", StringComparison.OrdinalIgnoreCase))
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
        return null;
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
