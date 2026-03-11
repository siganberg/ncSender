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

        _manager = new PendantManager(
            NullLogger<PendantManager>.Instance,
            _controller.Object,
            _broadcaster.Object,
            serverContext.Object,
            jobManager.Object,
            commandProcessor.Object,
            _settings.Object);
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
        // Check which handler has event subscribers (is the active one)
        return _handlers.FirstOrDefault(h => h.HasRawMessageSubscribers);
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
    public void WiredThenDongle_SwitchesToDongle()
    {
        // Connect wired first
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);
        SimulatePendantPing();

        Assert.Equal("usb", GetStatus().ActiveConnectionType);

        // Now dongle appears
        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);

        // Active handler should switch to dongle
        var active = GetActiveHandler();
        Assert.NotNull(active);
        Assert.Equal("/dev/cu.usbmodem201201", active.ConnectedPort);

        // Simulate ping through dongle to complete handshake
        SimulatePendantPing();

        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
        Assert.Equal("espnow", status.ActiveConnectionType);
        Assert.True(status.OtaReady); // USB still connected for OTA
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

        Assert.Equal("espnow", GetStatus().ActiveConnectionType);

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

        Assert.Equal("espnow", GetStatus().ActiveConnectionType);

        // Wired USB removed — should NOT disrupt dongle
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
    public void DongleFirst_ThenWired_DongleStaysActive()
    {
        var dongle = MakeDongleDevice();
        _manager.HandleDeviceFound(dongle);
        SimulatePendantPing();

        Assert.Equal("espnow", GetStatus().ActiveConnectionType);
        Assert.False(GetStatus().OtaReady); // No USB yet

        // Wired USB appears
        var pendant = MakePendantDevice();
        _manager.HandleDeviceFound(pendant);

        // Dongle should remain active
        var active = GetActiveHandler();
        Assert.NotNull(active);
        Assert.Equal("/dev/cu.usbmodem201201", active.ConnectedPort);

        var status = GetStatus();
        Assert.Equal("espnow", status.ActiveConnectionType);
        Assert.True(status.OtaReady); // USB now available for OTA
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

        Assert.Equal("espnow", GetStatus().ActiveConnectionType);

        // Dongle lost → falls back to USB
        _manager.HandleDeviceLost(dongle);
        SimulatePendantPing();
        Assert.Equal("usb", GetStatus().ActiveConnectionType);

        // Dongle comes back → switches back
        var dongle2 = MakeDongleDevice("/dev/cu.usbmodem201202");
        _manager.HandleDeviceFound(dongle2);
        SimulatePendantPing();

        Assert.Equal("espnow", GetStatus().ActiveConnectionType);
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
        Assert.Equal("espnow", GetStatus().ActiveConnectionType); // Still on dongle
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
            Assert.Equal("espnow", GetStatus().ActiveConnectionType);

            _manager.HandleDeviceLost(dongle);
            SimulatePendantPing();
            Assert.Equal("usb", GetStatus().ActiveConnectionType);
        }

        // Should end in stable USB state
        var status = GetStatus();
        Assert.Equal("connected", status.ConnectionState);
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
