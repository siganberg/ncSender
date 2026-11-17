using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

public class AutoConnectServiceTests : IDisposable
{
    private readonly Mock<ICncController> _controller = new();
    private readonly Mock<ISettingsManager> _settings = new();
    private string _port = "81";

    public AutoConnectServiceTests()
    {
        _settings.Setup(s => s.GetSetting<string>("connection.type", It.IsAny<string?>())).Returns("ethernet");
        _settings.Setup(s => s.GetSetting<string>("connection.ip", It.IsAny<string?>())).Returns("192.168.5.1");
        _settings.Setup(s => s.GetSetting<string>("connection.protocol", It.IsAny<string?>())).Returns("websocket");
        _settings.Setup(s => s.GetSetting<int>("connection.port", It.IsAny<int>())).Returns(() => int.Parse(_port));
        _settings.Setup(s => s.GetSetting<int>("connection.baudRate", It.IsAny<int>())).Returns(115200);
        _settings.Setup(s => s.GetSetting<int>("connection.serverPort", It.IsAny<int>())).Returns(8090);
    }

    private readonly TimeSpan _readyTimeout = AutoConnectService.ReadyTimeout;

    public void Dispose() => AutoConnectService.ReadyTimeout = _readyTimeout;

    private AutoConnectService Service() =>
        new(_controller.Object, _settings.Object, Mock.Of<IPendantManager>(), NullLogger<AutoConnectService>.Instance);

    [Fact]
    public async Task Ethernet_ConnectsWhenNothingIsOpen()
    {
        await Service().TryConnectAsync(CancellationToken.None);

        _controller.Verify(c => c.ConnectAsync(It.Is<ConnectionSettings>(s => s.Port == 81), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Ethernet_WaitsWhileAConnectionIsStillVerifying()
    {
        var service = Service();
        await service.TryConnectAsync(CancellationToken.None);
        _controller.Setup(c => c.IsTransportOpen).Returns(true);

        for (var i = 0; i < 4; i++)
            await service.TryConnectAsync(CancellationToken.None);

        _controller.Verify(c => c.ConnectAsync(It.IsAny<ConnectionSettings>(), It.IsAny<CancellationToken>()), Times.Once);
        _controller.Verify(c => c.Disconnect(), Times.Never);
    }

    [Fact]
    public async Task SettingsChange_ClosesAConnectionStillVerifying()
    {
        var service = Service();
        await service.TryConnectAsync(CancellationToken.None);
        _controller.Setup(c => c.IsTransportOpen).Returns(true);
        _controller.Setup(c => c.Disconnect()).Callback(() => _controller.Setup(c => c.IsTransportOpen).Returns(false));
        _port = "23";

        await service.TryConnectAsync(CancellationToken.None);

        _controller.Verify(c => c.Disconnect(), Times.Once);
        _controller.Verify(c => c.ConnectAsync(It.Is<ConnectionSettings>(s => s.Port == 23), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Ethernet_GivesUpOnAConnectionThatNeverGetsReady()
    {
        // Greeted, say, but never sent a status report.
        AutoConnectService.ReadyTimeout = TimeSpan.FromMilliseconds(300);
        _controller.Setup(c => c.ConnectAsync(It.IsAny<ConnectionSettings>(), It.IsAny<CancellationToken>()))
            .Callback(() => _controller.Setup(c => c.IsTransportOpen).Returns(true))
            .Returns(Task.CompletedTask);
        _controller.Setup(c => c.Disconnect()).Callback(() => _controller.Setup(c => c.IsTransportOpen).Returns(false));

        await Service().TryConnectAsync(CancellationToken.None);

        _controller.Verify(c => c.Disconnect(), Times.Once);
        Assert.False(_controller.Object.IsTransportOpen);
    }
}
