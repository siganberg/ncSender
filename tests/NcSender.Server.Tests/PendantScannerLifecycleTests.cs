using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Pendant;

namespace NcSender.Server.Tests;

/// <summary>
/// The pendant/dongle USB scanner runs for the life of the process. It used to
/// start only once the CNC controller connected and stop when it dropped, which
/// hid a plugged-in, healthy wireless dongle (and every accessory behind it)
/// whenever the machine was off or unreachable. These tests lock in the new
/// lifecycle without touching the CNC's own USB path: the scanner is
/// descriptor-driven and the CNC auto-connect skips the ports it holds.
/// </summary>
public class PendantScannerLifecycleTests : IDisposable
{
    private readonly List<PendantManager> _managers = new();
    private readonly List<MockSerialHandler> _handlers = new();

    public void Dispose()
    {
        foreach (var m in _managers) m.StopAutoConnect();
        foreach (var h in _handlers) h.Dispose();
    }

    private (PendantManager Manager, Mock<ICncController> Controller) Build(bool cncConnected, bool autoConnect = true)
    {
        var controller = new Mock<ICncController>();
        controller.Setup(c => c.IsConnected).Returns(cncConnected);

        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState());

        var settings = new Mock<ISettingsManager>();
        settings.Setup(s => s.GetSetting<bool>("pendant.autoConnect", true)).Returns(autoConnect);

        var dongleDevices = new Mock<IDongleDeviceService>();
        var usbCatalog = new Mock<INcSenderUsbCatalog>();
        usbCatalog.Setup(c => c.GetDevices()).Returns(Array.Empty<NcSenderUsbDevice>());
        var xprobeRouter = new NcSender.Server.Dongle.XProbeRouter(
            dongleDevices.Object, usbCatalog.Object,
            NullLogger<NcSender.Server.Dongle.XProbeRouter>.Instance);
        var dongleOta = new NcSender.Server.Dongle.DongleOtaService(
            NullLogger<NcSender.Server.Dongle.DongleOtaService>.Instance,
            dongleDevices.Object, usbCatalog.Object, xprobeRouter,
            new NcSender.Server.Usb.UsbPortLeases(), broadcaster.Object);

        var manager = new PendantManager(
            NullLogger<PendantManager>.Instance,
            controller.Object,
            broadcaster.Object,
            serverContext.Object,
            new Mock<IJobManager>().Object,
            new Mock<ICommandProcessor>().Object,
            settings.Object,
            dongleDevices.Object,
            dongleOta,
            new Mock<IGateService>().Object,
            usbCatalog.Object,
            new NcSender.Server.Usb.UsbPortLeases(),
            new Mock<IProbeService>().Object);
        _managers.Add(manager);
        return (manager, controller);
    }

    private PendantPortScanner.TrackedDevice MakeDongle(string port = "/dev/ttyACM0")
    {
        var handler = new MockSerialHandler(port, connected: true);
        _handlers.Add(handler);
        return new PendantPortScanner.TrackedDevice(port, PendantPortScanner.DeviceType.Dongle, handler);
    }

    [Fact]
    public void ScannerRuns_WhenCncIsNotConnected()
    {
        var (manager, _) = Build(cncConnected: false);
        Assert.True(manager.ScannerRunning);
    }

    [Fact]
    public void ScannerDoesNotStart_WhenAutoConnectIsDisabled()
    {
        var (manager, _) = Build(cncConnected: false, autoConnect: false);
        Assert.False(manager.ScannerRunning);
    }

    [Fact]
    public void DongleFound_WithoutCnc_ReportsDongleConnected()
    {
        var (manager, _) = Build(cncConnected: false);
        manager.HandleDeviceFound(MakeDongle());

        Assert.True(manager.GetStatus().DongleConnected);
    }

    [Fact]
    public void CncDisconnect_KeepsScannerAndDongle()
    {
        var (manager, controller) = Build(cncConnected: true);
        manager.HandleDeviceFound(MakeDongle());
        Assert.True(manager.GetStatus().DongleConnected);

        controller.Setup(c => c.IsConnected).Returns(false);
        controller.Raise(c => c.ConnectionStatusChanged += null, "disconnected", false);

        Assert.True(manager.ScannerRunning);
        Assert.True(manager.GetStatus().DongleConnected);
    }

    [Fact]
    public void CncConnectAndDisconnectCycle_ScannerStaysUp()
    {
        var (manager, controller) = Build(cncConnected: false);
        controller.Raise(c => c.ConnectionStatusChanged += null, "connected", true);
        controller.Raise(c => c.ConnectionStatusChanged += null, "disconnected", false);
        controller.Raise(c => c.ConnectionStatusChanged += null, "connected", true);

        Assert.True(manager.ScannerRunning);
    }
}
