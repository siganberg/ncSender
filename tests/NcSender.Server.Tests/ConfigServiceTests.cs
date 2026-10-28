using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Config;

namespace NcSender.Server.Tests;

public class ConfigServiceTests
{
    private readonly Mock<ISettingsManager> _settings = new();
    private readonly Mock<ICncController> _controller = new();

    private ConfigService CreateService() =>
        new(_settings.Object, _controller.Object, NullLogger<ConfigService>.Instance);

    [Theory]
    [InlineData("$/Config/Filename=custom_machine.yaml", "custom_machine.yaml")]
    [InlineData("$Config/Filename=my-router.yaml", "my-router.yaml")]
    [InlineData("$/Config/Filename=/localfs/custom.yaml", "localfs/custom.yaml")]
    [InlineData("$/Config/Filename=/custom.yaml", "custom.yaml")]
    [InlineData("[MSG:INFO: Configuration file:laser.yaml]", null)]
    [InlineData("ok", null)]
    public void TryParseConfigFilename_ExtractsExpectedValue(string line, string? expected)
    {
        Assert.Equal(expected, ConfigService.TryParseConfigFilename(line));
    }

    [Fact]
    public async Task GetConfigFilenameAsync_QueriesControllerAndReturnsCustomName()
    {
        _controller.SetupGet(c => c.IsConnected).Returns(true);
        _controller
            .Setup(c => c.SendCommandAsync("$Config/Filename", It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .Callback<string, CommandOptions?, CancellationToken>((_, _, _) =>
            {
                _controller.Raise(c => c.DataReceived += null, "$/Config/Filename=my_fluidnc.yaml", "system");
            })
            .ReturnsAsync(new CommandResult { Status = "success" });

        var svc = CreateService();
        var filename = await svc.GetConfigFilenameAsync();

        Assert.Equal("my_fluidnc.yaml", filename);
    }

    [Fact]
    public async Task GetConfigFilenameAsync_FallsBackToDefaultWhenDisconnected()
    {
        _controller.SetupGet(c => c.IsConnected).Returns(false);

        var svc = CreateService();
        var filename = await svc.GetConfigFilenameAsync();

        Assert.Equal("config.yaml", filename);
        _controller.Verify(
            c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task GetConfigFilenameAsync_FallsBackToDefaultWhenCommandFails()
    {
        _controller.SetupGet(c => c.IsConnected).Returns(true);
        _controller
            .Setup(c => c.SendCommandAsync("$Config/Filename", It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Controller busy"));

        var svc = CreateService();
        var filename = await svc.GetConfigFilenameAsync();

        Assert.Equal("config.yaml", filename);
    }
}
