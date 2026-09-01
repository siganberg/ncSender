using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Pendant;

namespace NcSender.Server.Tests;

/// <summary>
/// Tests the PendantManager's dual-connection state machine:
/// - USB and dongle are tracked independently
/// - Dongle takes priority when both are connected
/// - Fallback works when active connection is lost
/// - OTA readiness depends on direct USB
/// </summary>
public class PendantConnectionTests : IDisposable
{
    private readonly PendantManager _manager;
    private readonly Mock<ICncController> _controller;
    private readonly Mock<IBroadcaster> _broadcaster;
    private readonly Mock<ISettingsManager> _settings;
    private readonly List<MockSerialHandler> _handlers = new();

    public PendantConnectionTests()
    {
        _controller = new Mock<ICncController>();
        _controller.Setup(c => c.IsConnected).Returns(true);

        _broadcaster = new Mock<IBroadcaster>();
        _broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState());

        var jobManager = new Mock<IJobManager>();
        var commandProcessor = new Mock<ICommandProcessor>();

        _settings = new Mock<ISettingsManager>();
        _settings.Setup(s => s.GetSetting<bool>("pendant.autoConnect", true)).Returns(true);

        var dongleDevices = new Mock<IDongleDeviceService>();
        var gates = new Mock<IGateService>();
        // Pendant-started probes go through the same service the app uses; these
        // tests never fire one, so an unconfigured mock is enough.
        var probeService = new Mock<IProbeService>();
        var usbCatalog = new Mock<INcSenderUsbCatalog>();
        usbCatalog.Setup(c => c.GetDevices()).Returns(Array.Empty<NcSenderUsbDevice>());
        // The OTA service holds the XProbe router so it can park the port scan
        // for the duration of a firmware push. A real router over the same
        // no-device catalog mock never opens anything, so it needs no stubbing.
        var xprobeRouter = new NcSender.Server.Dongle.XProbeRouter(
            dongleDevices.Object,
            usbCatalog.Object,
            NullLogger<NcSender.Server.Dongle.XProbeRouter>.Instance);
        var dongleOta = new NcSender.Server.Dongle.DongleOtaService(
            NullLogger<NcSender.Server.Dongle.DongleOtaService>.Instance,
            dongleDevices.Object,
            usbCatalog.Object,
            xprobeRouter,
            new NcSender.Server.Usb.UsbPortLeases(),
            _broadcaster.Object);
        _manager = new PendantManager(
            NullLogger<PendantManager>.Instance,
            _controller.Object,
            _broadcaster.Object,
            serverContext.Object,
            jobManager.Object,
            commandProcessor.Object,
            _settings.Object,
            dongleDevices.Object,
            dongleOta,
            gates.Object,
            usbCatalog.Object,
            new NcSender.Server.Usb.UsbPortLeases(),
            probeService.Object
        );
    }

    public void Dispose()
    {
        foreach (var h in _handlers)
            h.Dispose();
    }

    #region Helpers

    private MockSerialHandler CreateHandler(string port, bool connected = true)
    {
        var handler = new MockSerialHandler(port, connected);
        _handlers.Add(handler);
        return handler;
    }

    private PendantPortScanner.TrackedDevice MakePendantDevice(string port = "/dev/cu.usbmodem21201")
    {
        var handler = CreateHandler(port);
        return new PendantPortScanner.TrackedDevice(port, PendantPortScanner.DeviceType.Pendant, handler);
    }

    private PendantPortScanner.TrackedDevice MakeDongleDevice(string port = "/dev/cu.usbmodem201201")
    {
        var handler = CreateHandler(port);
        return new PendantPortScanner.TrackedDevice(port, PendantPortScanner.DeviceType.Dongle, handler);
    }

    /// <summary>Simulate a ping from pendant to complete the handshake.</summary>
    private void SimulatePendantPing()
    {
        // The active handler should have RawMessageReceived wired — fire "P" through it
        var activeHandler = GetActiveHandler();
        activeHandler?.SimulateRawMessage("P");
    }

    private MockSerialHandler? GetActiveHandler()
    {
        // Read the manager's actual active handler rather than inferring it from
        // event subscriptions. The old version returned the first handler with
        // any RawMessageReceived subscriber, which only coincided with "active"
        // while nothing else subscribed. The dongle now keeps a permanent
        // subscription so peer traffic is read whichever transport the pendant
        // is on, so that proxy reports the dongle even when a cable holds the
        // link — testing the helper's assumption rather than the manager.
        var field = typeof(PendantManager).GetField("_serialHandler",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        return field?.GetValue(_manager) as MockSerialHandler;
    }

    private PendantStatus GetStatus() => _manager.GetStatus();

    #endregion

    // ──────────────────────────────────────────────────────────
    // Test 1: No dongle, no wired USB → no active channel
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void NoDevices_StatusIsDisconnected()
    {
        var status = GetStatus();

        Assert.Equal("disconnected", status.ConnectionState);
        Assert.Equal("none", status.ActiveConnectionType);
        Assert.Null(status.UsbPendant);
        Assert.False(status.OtaReady);
        Assert.False(status.PendantEnabled);
    }

    // ──────────────────────────────────────────────────────────
    // Test 2: Wired USB connected → wired channel for communication
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void WiredOnly_BecomesActiveChannel()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);

        // Handler should be wired as active
        var active = GetActiveHandler();
        Assert.NotNull(active);
        Assert.Equal("/dev/cu.usbmodem21201", active.ConnectedPort);

        // Simulate handshake
        SimulatePendantPing();

        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
        Assert.Equal("usb", status.ActiveConnectionType);
        Assert.True(status.OtaReady);
    }

    // ──────────────────────────────────────────────────────────
    // Test 3: Wired connected, then dongle connected → switch to dongle
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void WiredThenDongle_StaysOnWired()
    {
        // Connect wired first
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        Assert.Equal("usb", GetStatus().ActiveConnectionType);

        // Now dongle appears
        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);

        // The cable keeps the link — wired outranks the radio for every
        // accessory, the pendant included. The dongle stays available as the
        // fallback rather than taking over.
        var active = GetActiveHandler();
        Assert.NotNull(active);
        Assert.Equal("/dev/cu.usbmodem21201", active.ConnectedPort);

        SimulatePendantPing();

        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
        Assert.Equal("usb", status.ActiveConnectionType);
        Assert.True(status.OtaReady);
    }

    // ──────────────────────────────────────────────────────────
    // Test 4: Wired + dongle connected, dongle disconnects → fall back to wired
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void DongleDisconnected_FallsBackToWired()
    {
        // Both connected, dongle active
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        // Wired holds the link while the cable is present.
        Assert.Equal("usb", GetStatus().ActiveConnectionType);

        // Dongle removed
        _manager.HandleDeviceLost(dongle);

        // Should fall back to pendant USB
        var active = GetActiveHandler();
        Assert.NotNull(active);
        Assert.Equal("/dev/cu.usbmodem21201", active.ConnectedPort);

        // Simulate ping through USB to re-establish handshake
        SimulatePendantPing();

        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
        Assert.Equal("usb", status.ActiveConnectionType);
        Assert.True(status.OtaReady);
    }

    // ──────────────────────────────────────────────────────────
    // Test 5: Wired + dongle connected, wired disconnects → stay on dongle
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void WiredDisconnected_StaysOnDongle()
    {
        // Both connected, dongle active
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        // Wired wins while the cable is there.
        Assert.Equal("usb", GetStatus().ActiveConnectionType);

        // Wired USB removed — the dongle takes over as the fallback
        _manager.HandleDeviceLost(pendant);

        var active = GetActiveHandler();
        Assert.NotNull(active);
        Assert.Equal("/dev/cu.usbmodem201201", active.ConnectedPort);

        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
        Assert.Equal("espnow", status.ActiveConnectionType);
        Assert.False(status.OtaReady); // No USB → no OTA
    }

    // ──────────────────────────────────────────────────────────
    // Test 6: Dongle connected first, then wired → dongle stays active, wired for OTA
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void DongleFirst_ThenWired_SwitchesToWired()
    {
        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        Assert.Equal("espnow", GetStatus().ActiveConnectionType);
        Assert.False(GetStatus().OtaReady); // No USB yet

        // Wired USB appears — it takes the link off the dongle
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);

        var active = GetActiveHandler();
        Assert.NotNull(active);
        Assert.Equal("/dev/cu.usbmodem21201", active.ConnectedPort);

        var status = GetStatus();
        Assert.Equal("usb", status.ActiveConnectionType);
        Assert.True(status.OtaReady);
    }

    // ──────────────────────────────────────────────────────────
    // Test 7: Both disconnected → fully disconnected
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void BothDisconnected_FullyDisconnected()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        // Remove both
        _manager.HandleDeviceLost(dongle);
        _manager.HandleDeviceLost(pendant);

        var status = GetStatus();
        Assert.Equal("disconnected", status.ConnectionState);
        Assert.Equal("none", status.ActiveConnectionType);
        Assert.False(status.OtaReady);
    }

    // ──────────────────────────────────────────────────────────
    // Test 8: Dongle lost and regained → reconnects
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void DongleLostAndRegained_Reconnects()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        // The cable is present the whole way through, so it holds the link
        // regardless of what the dongle does.
        Assert.Equal("usb", GetStatus().ActiveConnectionType);

        _manager.HandleDeviceLost(dongle);
        SimulatePendantPing();
        Assert.Equal("usb", GetStatus().ActiveConnectionType);

        // Dongle comes back — still the fallback, still not the active link
        var dongle2 = MakeDongleDevice("/dev/cu.usbmodem201202");
        _manager.HandleDeviceFound(dongle2);
        SimulatePendantPing();

        Assert.Equal("usb", GetStatus().ActiveConnectionType);
        Assert.True(GetStatus().DongleConnected);
    }

    // ──────────────────────────────────────────────────────────
    // Test 9: Wired only, wired disconnects → fully disconnected
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void WiredOnly_Disconnects_FullyDisconnected()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        Assert.Equal("connected", GetStatus().ConnectionState);

        _manager.HandleDeviceLost(pendant);

        var status = GetStatus();
        Assert.Equal("disconnected", status.ConnectionState);
        Assert.Equal("none", status.ActiveConnectionType);
    }

    // ──────────────────────────────────────────────────────────
    // Test 10: Dongle only, no wired → OTA not ready
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void DongleOnly_OtaNotReady()
    {
        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
        Assert.Equal("espnow", status.ActiveConnectionType);
        Assert.False(status.OtaReady);
    }

    // ──────────────────────────────────────────────────────────
    // Test 11: Dongle only, dongle disconnects → fully disconnected
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void DongleOnly_Disconnects_FullyDisconnected()
    {
        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        Assert.Equal("connected", GetStatus().ConnectionState);

        _manager.HandleDeviceLost(dongle);

        var status = GetStatus();
        Assert.Equal("disconnected", status.ConnectionState);
        Assert.Equal("none", status.ActiveConnectionType);
    }

    // ──────────────────────────────────────────────────────────
    // Test 12: Wired + dongle, wired lost then regained → OTA restored
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void WiredLostAndRegained_OtaRestored()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        Assert.True(GetStatus().OtaReady);

        // Wired lost
        _manager.HandleDeviceLost(pendant);
        Assert.False(GetStatus().OtaReady);

        // Wired regained
        var pendant2 = MakePendantDevice("/dev/cu.usbmodem21202");
        _manager.HandleDeviceFound(pendant2);

        Assert.True(GetStatus().OtaReady);
        // The regained cable takes the link back off the dongle.
        Assert.Equal("usb", GetStatus().ActiveConnectionType);
    }

    // ──────────────────────────────────────────────────────────
    // Test 13: No handshake yet → status is disconnected even with handler
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void HandlerConnected_NoHandshake_StillDisconnected()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);

        // Handler is wired but no ping received yet
        var status = GetStatus();
        Assert.Equal("disconnected", status.ConnectionState);
        Assert.Equal("none", status.ActiveConnectionType);
    }

    // ──────────────────────────────────────────────────────────
    // Test 14: Rapid dongle disconnect/reconnect (flapping)
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void DongleFlapping_HandlesGracefully()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        // Rapid connect/disconnect cycles
        for (int i = 0; i < 5; i++)
        {
            var dongle = MakeDongleDevice($"/dev/cu.usbmodem20120{i}");
            _manager.HandleDeviceFound(dongle);
            SimulatePendantPing();
            // A flapping dongle must not disturb a pendant that is on a cable.
            Assert.Equal("usb", GetStatus().ActiveConnectionType);

            _manager.HandleDeviceLost(dongle);
            SimulatePendantPing();
            Assert.Equal("usb", GetStatus().ActiveConnectionType);
        }

        // Should end in stable USB state
        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
        Assert.Equal("usb", status.ActiveConnectionType);
    }

    // ──────────────────────────────────────────────────────────
    // A dongle whose read loop dies must stop reporting connected,
    // even while its port handle still claims to be open.
    // ──────────────────────────────────────────────────────────

    [Fact]
    public void DongleReadLoopDies_ClearsDongleConnected()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        Assert.True(GetStatus().DongleConnected);

        // The dongle self-resets and re-enumerates. Its read loop fails, but the
        // mock keeps reporting IsConnected — exactly like a real SerialPort whose
        // handle stays open over a dead device. The manager must not keep serving
        // DongleConnected off that stale reference: doing so lit the toolbar icon
        // while every $LICENSE query timed out and the dialog said "not connected".
        ((MockSerialHandler)dongle.Handler).SimulateDisconnect();

        Assert.False(GetStatus().DongleConnected);
    }

    [Fact]
    public void DongleReadLoopDies_ThenRediscovered_ReportsConnectedAgain()
    {
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();
        ((MockSerialHandler)dongle.Handler).SimulateDisconnect();
        Assert.False(GetStatus().DongleConnected);

        // Scanner reopens the port and hands over a fresh handler — the state must
        // recover without a restart.
        var reopened = MakeDongleDevice();
        _manager.HandleDeviceFound(reopened);
        SimulatePendantPing();

        var status = GetStatus();
        Assert.True(status.DongleConnected);
        // Recovered as the fallback — the cabled pendant still owns the link.
        Assert.Equal("usb", status.ActiveConnectionType);
    }
}

// ═══════════════════════════════════════════════════════════════
// Mock PendantSerialHandler for testing without real serial ports
// ═══════════════════════════════════════════════════════════════

/// <summary>
/// A mock serial handler that simulates pendant/dongle behavior.
/// Overrides IsConnected/ConnectedPort to avoid real SerialPort dependency.
/// Exposes methods to trigger events for testing.
/// </summary>
public class MockSerialHandler : PendantSerialHandler
{
    private readonly bool _simulateConnected;
    private readonly string _port;

    public MockSerialHandler(string port, bool connected = true)
        : base(NullLogger.Instance)
    {
        _port = port;
        _simulateConnected = connected;
    }

    public override bool IsConnected => _simulateConnected;
    public override string? ConnectedPort => _port;
    public override Task SendRawAsync(string message) => Task.CompletedTask;
    public override Task SendMessageAsync<T>(T message, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo) => Task.CompletedTask;

    public bool HasRawMessageSubscribers => HasRawSubscribers;

    public void SimulateRawMessage(string message) => FireRawMessage(message);
    public void SimulateDisconnect() => FirePortDisconnected();

    public void Dispose() { }
}
