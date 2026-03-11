using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Server.CommandHistory;
using NcSender.Server.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

public class CommandHistoryServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly Mock<IBroadcaster> _broadcaster;

    public CommandHistoryServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"ncsender-test-{Guid.NewGuid()}");
        Directory.CreateDirectory(_tempDir);
        _broadcaster = new Mock<IBroadcaster>();
        _broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    private CommandHistoryService CreateService()
    {
        var filePath = Path.Combine(_tempDir, "command-history.json");
        return new CommandHistoryService(
            _broadcaster.Object,
            NullLogger<CommandHistoryService>.Instance,
            filePath);
    }

    [Fact]
    public async Task AddCommand_AddsToHistory()
    {
        var svc = CreateService();

        await svc.AddCommandAsync("G0 X10");

        var history = svc.GetHistory();
        Assert.Single(history);
        Assert.Equal("G0 X10", history[0]);
    }

    [Fact]
    public async Task AddCommand_SkipsConsecutiveDuplicates()
    {
        var svc = CreateService();

        await svc.AddCommandAsync("G0 X10");
        await svc.AddCommandAsync("G0 X10");
        await svc.AddCommandAsync("G0 X10");

        var history = svc.GetHistory();
        Assert.Single(history);
    }

    [Fact]
    public async Task AddCommand_AllowsNonConsecutiveDuplicates()
    {
        var svc = CreateService();

        await svc.AddCommandAsync("G0 X10");
        await svc.AddCommandAsync("G0 Y20");
        await svc.AddCommandAsync("G0 X10");

        var history = svc.GetHistory();
        Assert.Equal(3, history.Count);
    }

    [Fact]
    public async Task AddCommand_TrimsToMaxSize()
    {
        var svc = CreateService();

        for (var i = 0; i < 510; i++)
            await svc.AddCommandAsync($"G0 X{i}");

        var history = svc.GetHistory();
        Assert.Equal(500, history.Count);
        Assert.Equal("G0 X10", history[0]); // First 10 trimmed
    }

    [Fact]
    public async Task AddCommand_SkipsEmptyCommands()
    {
        var svc = CreateService();

        await svc.AddCommandAsync("");
        await svc.AddCommandAsync("  ");

        var history = svc.GetHistory();
        Assert.Empty(history);
    }

    [Fact]
    public async Task AddCommand_BroadcastsEvent()
    {
        var svc = CreateService();

        await svc.AddCommandAsync("G28");

        _broadcaster.Verify(b => b.Broadcast("command-history-appended", It.IsAny<JsonElement>()), Times.Once);
    }

    [Fact]
    public async Task AddCommand_TrimsWhitespace()
    {
        var svc = CreateService();

        await svc.AddCommandAsync("  G0 X10  ");

        var history = svc.GetHistory();
        Assert.Equal("G0 X10", history[0]);
    }
}
