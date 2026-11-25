using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Pendant;

namespace NcSender.Server.Tests;

/// <summary>
/// The PiBot pendant sits behind a plain CH340, which many CNC controllers
/// use too. The scanner listens to such a port once; until it has, the CNC
/// auto-connect must keep off it (it opens with RTS on, which holds the
/// pendant in reset). The CNC's own port is never listened to.
/// </summary>
public class PiBotBridgeScanTests
{
    private static NcSenderUsbDevice Bridge(string port) =>
        new(port, NcSenderUsbKind.SerialBridge, 0x1A86, 0x7523, null, "USB Serial");

    private static PendantPortScanner Scanner(Func<string, bool>? isCncPort, params string[] bridges)
    {
        var catalog = new Mock<INcSenderUsbCatalog>();
        catalog.Setup(c => c.GetDevices()).Returns(Array.Empty<NcSenderUsbDevice>());
        catalog.Setup(c => c.GetSerialBridges()).Returns(bridges.Select(Bridge).ToList());
        return new PendantPortScanner(NullLogger.Instance, catalog.Object, null, isCncPort);
    }

    [Fact]
    public void A_bridge_not_listened_to_yet_is_kept_from_the_cnc_auto_connect()
    {
        using var scanner = Scanner(null, "/dev/ttyUSB0");
        Assert.Contains("/dev/ttyUSB0", scanner.AllOccupiedPorts);
    }

    [Fact]
    public void The_cnc_port_is_never_held_back()
    {
        using var scanner = Scanner(port => port == "/dev/ttyUSB0", "/dev/ttyUSB0", "/dev/ttyUSB1");
        var occupied = scanner.AllOccupiedPorts;
        Assert.DoesNotContain("/dev/ttyUSB0", occupied);
        Assert.Contains("/dev/ttyUSB1", occupied);
    }

    [Fact]
    public void A_catalog_without_bridges_holds_nothing_back()
    {
        var catalog = new Mock<INcSenderUsbCatalog>();
        catalog.Setup(c => c.GetDevices()).Returns(Array.Empty<NcSenderUsbDevice>());
        using var scanner = new PendantPortScanner(NullLogger.Instance, catalog.Object);
        Assert.Empty(scanner.AllOccupiedPorts);
    }

    [Fact]
    public async Task No_port_is_listened_to_while_the_machine_is_busy()
    {
        var catalog = new Mock<INcSenderUsbCatalog>();
        catalog.Setup(c => c.GetDevices()).Returns(Array.Empty<NcSenderUsbDevice>());
        catalog.Setup(c => c.GetSerialBridges()).Returns(new List<NcSenderUsbDevice> { Bridge("/dev/does-not-exist-pibot") });
        using var scanner = new PendantPortScanner(NullLogger.Instance, catalog.Object, null, null, () => true);

        scanner.Start();
        await Task.Delay(400);

        // Not opened, so not given up on either: still waiting its turn.
        Assert.Contains("/dev/does-not-exist-pibot", scanner.AllOccupiedPorts);
    }

    [Theory]
    [InlineData("Grbl 1.1f ['$' or '$H' for help]")]
    [InlineData("GrblHAL 1.1f ['$' or '$HELP' for help]")]
    [InlineData("[MSG:INFO: FluidNC v3.9.1]")]
    [InlineData("<Idle|MPos:0.000,0.000,0.000|FS:0,0>")]
    [InlineData("ALARM:1")]
    [InlineData("error:9")]
    public void Controller_lines_are_told_apart(string line)
    {
        Assert.True(PendantPortScanner.LooksLikeController(line));
    }

    [Theory]
    [InlineData("$ID:pendant")]
    [InlineData("[BOOT      0ms] hal::init done")]
    [InlineData("[ESPNOW] No saved pairing found")]
    [InlineData("P")]
    public void Pendant_lines_are_not_taken_for_a_controller(string line)
    {
        Assert.False(PendantPortScanner.LooksLikeController(line));
    }

    /// <summary>
    /// On the real pendant: set PIBOT_PORT to its port. Opens it the way the
    /// scanner does and checks it is found and still answers afterwards.
    /// </summary>
    [Fact]
    public async Task Hardware_the_pibot_is_found_and_keeps_running()
    {
        var port = Environment.GetEnvironmentVariable("PIBOT_PORT");
        if (string.IsNullOrEmpty(port)) return;

        var catalog = new Mock<INcSenderUsbCatalog>();
        catalog.Setup(c => c.GetDevices()).Returns(Array.Empty<NcSenderUsbDevice>());
        catalog.Setup(c => c.GetSerialBridges()).Returns(new List<NcSenderUsbDevice> { Bridge(port) });
        using var scanner = new PendantPortScanner(NullLogger.Instance, catalog.Object);

        var found = new TaskCompletionSource<PendantPortScanner.TrackedDevice>();
        scanner.DeviceFound += d => found.TrySetResult(d);
        var started = DateTime.UtcNow;
        scanner.Start();
        var device = await found.Task.WaitAsync(TimeSpan.FromSeconds(12));
        Console.WriteLine($"found {device.Type} on {device.Port} after {(DateTime.UtcNow - started).TotalSeconds:0.0}s");
        Assert.Equal(PendantPortScanner.DeviceType.Pendant, device.Type);

        // Still running (not in the download mode): it answers on the open port.
        var lines = new List<string>();
        var answered = new TaskCompletionSource<bool>();
        device.Handler.RawMessageReceived += l => { lock (lines) lines.Add(l); if (l.Contains("$ID:pendant")) answered.TrySetResult(true); };
        await Task.Delay(2500);
        await device.Handler.SendRawAsync("$ID");
        await answered.Task.WaitAsync(TimeSpan.FromSeconds(3));
        await Task.Delay(4000);
        lock (lines)
        {
            Console.WriteLine("lines: " + string.Join(" | ", lines.Take(12)));
            Assert.DoesNotContain(lines, l => l.Contains("hal::init"));   // no second reboot while held
        }
    }
}
