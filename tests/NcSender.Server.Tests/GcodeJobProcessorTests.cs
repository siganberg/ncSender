using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;
using NcSender.Server.Job;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

public class GcodeJobProcessorTests : IDisposable
{
    private readonly string _tempDir;
    private readonly string _cachePath;

    public GcodeJobProcessorTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"ncsender-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDir);
        _cachePath = Path.Combine(_tempDir, "current.gcode");
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    private (GcodeJobProcessor Processor, Mock<ICncController> Controller, Mock<IServerContext> Context)
        CreateProcessor(string gcodeContent, int totalLines)
    {
        File.WriteAllText(_cachePath, gcodeContent);

        var controller = new Mock<ICncController>();
        controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>()))
            .ReturnsAsync(new CommandResult { Status = "success" });

        var commandProcessor = new Mock<ICommandProcessor>();
        commandProcessor.Setup(p => p.ProcessAsync(It.IsAny<string>(), It.IsAny<CommandProcessorContext>()))
            .ReturnsAsync((string cmd, CommandProcessorContext ctx) => new CommandProcessorResult
            {
                ShouldContinue = true,
                Commands = [new ProcessedCommand { Command = cmd, IsOriginal = true }]
            });

        var context = new Mock<IServerContext>();
        var state = new ServerState
        {
            JobLoaded = new JobInfo
            {
                Filename = "test.gcode",
                TotalLines = totalLines,
                Status = "running"
            }
        };
        context.Setup(c => c.State).Returns(state);

        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
            .Returns(Task.CompletedTask);

        var processor = new GcodeJobProcessor(
            controller.Object,
            commandProcessor.Object,
            context.Object,
            NullLogger<JobManager>.Instance);

        return (processor, controller, context);
    }

    // Override the cache path for testing by writing to the real cache dir temporarily
    private string SetupCacheFile(string content)
    {
        var cacheDir = PathUtils.GetGcodeCacheDir();
        Directory.CreateDirectory(cacheDir);
        var path = Path.Combine(cacheDir, "current.gcode");
        File.WriteAllText(path, content);
        return path;
    }

    [Fact]
    public async Task ProcessLines_CountsAndSendsCommands()
    {
        var gcode = "G0 X0 Y0\nG1 X10 F500\nG1 X20 F500\n";
        var cachePath = SetupCacheFile(gcode);

        try
        {
            var (processor, controller, context) = CreateProcessor(gcode, 3);

            // We need to use the real cache path, so create a new processor
            // that reads from the actual cache location
            await processor.ProcessLinesAsync();

            // All 3 lines should have been sent (with N-number prefixes)
            controller.Verify(c => c.SendCommandAsync(
                It.IsAny<string>(),
                It.IsAny<CommandOptions?>()), Times.Exactly(3));
        }
        finally
        {
            if (File.Exists(cachePath))
                File.Delete(cachePath);
        }
    }

    [Fact]
    public async Task ProcessLines_SkipsBlankLinesAndComments()
    {
        var gcode = "G0 X0\n\n(comment)\n; another comment\nG1 X10 F500\n";
        var cachePath = SetupCacheFile(gcode);

        try
        {
            var (processor, controller, _) = CreateProcessor(gcode, 5);

            await processor.ProcessLinesAsync();

            // Only G0 X0 and G1 X10 should be sent (blanks + comments skipped)
            controller.Verify(c => c.SendCommandAsync(
                It.IsAny<string>(),
                It.IsAny<CommandOptions?>()), Times.Exactly(2));
        }
        finally
        {
            if (File.Exists(cachePath))
                File.Delete(cachePath);
        }
    }

    [Fact]
    public async Task ProcessLines_PrependsNNumbers()
    {
        var gcode = "G0 X0\nG1 X10 F500\n";
        var cachePath = SetupCacheFile(gcode);
        var sentCommands = new List<string>();

        try
        {
            var controller = new Mock<ICncController>();
            controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>()))
                .Callback<string, CommandOptions?>((cmd, _) => sentCommands.Add(cmd))
                .ReturnsAsync(new CommandResult { Status = "success" });

            var commandProcessor = new Mock<ICommandProcessor>();
            commandProcessor.Setup(p => p.ProcessAsync(It.IsAny<string>(), It.IsAny<CommandProcessorContext>()))
                .ReturnsAsync((string cmd, CommandProcessorContext ctx) => new CommandProcessorResult
                {
                    ShouldContinue = true,
                    Commands = [new ProcessedCommand { Command = cmd, IsOriginal = true }]
                });

            var context = new Mock<IServerContext>();
            var state = new ServerState
            {
                JobLoaded = new JobInfo { Filename = "test.gcode", TotalLines = 2, Status = "running" }
            };
            context.Setup(c => c.State).Returns(state);

            var broadcaster = new Mock<IBroadcaster>();
            broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
                .Returns(Task.CompletedTask);

            var processor = new GcodeJobProcessor(
                controller.Object, commandProcessor.Object, context.Object,
                NullLogger<JobManager>.Instance);

            await processor.ProcessLinesAsync();

            // Commands should have N-number prefix
            Assert.Equal(2, sentCommands.Count);
            Assert.StartsWith("N1 ", sentCommands[0]);
            Assert.StartsWith("N2 ", sentCommands[1]);
        }
        finally
        {
            if (File.Exists(cachePath))
                File.Delete(cachePath);
        }
    }

    [Fact]
    public async Task ProcessLines_StopHaltsProcessing()
    {
        // Create a large file - stop should prevent processing all lines
        var lines = Enumerable.Range(1, 1000).Select(i => $"G1 X{i} F500");
        var gcode = string.Join("\n", lines) + "\n";
        var cachePath = SetupCacheFile(gcode);
        var commandCount = 0;

        try
        {
            var controller = new Mock<ICncController>();
            // Add small delay to simulate real command processing time
            controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>()))
                .Returns(async () =>
                {
                    await Task.Yield();
                    Interlocked.Increment(ref commandCount);
                    return new CommandResult { Status = "success" };
                });

            var commandProcessor = new Mock<ICommandProcessor>();
            commandProcessor.Setup(p => p.ProcessAsync(It.IsAny<string>(), It.IsAny<CommandProcessorContext>()))
                .ReturnsAsync((string cmd, CommandProcessorContext ctx) => new CommandProcessorResult
                {
                    ShouldContinue = true,
                    Commands = [new ProcessedCommand { Command = cmd, IsOriginal = true }]
                });

            var context = new Mock<IServerContext>();
            var state = new ServerState
            {
                JobLoaded = new JobInfo { Filename = "test.gcode", TotalLines = 1000, Status = "running" }
            };
            context.Setup(c => c.State).Returns(state);

            var broadcaster = new Mock<IBroadcaster>();
            broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
                .Returns(Task.CompletedTask);

            var processor = new GcodeJobProcessor(
                controller.Object, commandProcessor.Object, context.Object,
                NullLogger<JobManager>.Instance);

            // Use a callback to stop once we've processed some lines
            var stopTriggered = false;
            controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>()))
                .Returns(async () =>
                {
                    var count = Interlocked.Increment(ref commandCount);
                    if (count >= 50 && !stopTriggered)
                    {
                        stopTriggered = true;
                        processor.Stop();
                    }
                    await Task.Yield();
                    return new CommandResult { Status = "success" };
                });

            await processor.ProcessLinesAsync();

            // Should have processed some but not all lines
            Assert.True(commandCount >= 50, $"Expected at least 50 commands, got {commandCount}");
            Assert.True(commandCount < 1000, $"Expected less than 1000 commands, got {commandCount}");
        }
        finally
        {
            if (File.Exists(cachePath))
                File.Delete(cachePath);
        }
    }

    [Fact]
    public async Task ProcessLines_PauseAndResume()
    {
        var gcode = string.Join("\n", Enumerable.Range(1, 100).Select(i => $"G1 X{i} F500")) + "\n";
        var cachePath = SetupCacheFile(gcode);

        try
        {
            var controller = new Mock<ICncController>();
            controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>()))
                .ReturnsAsync(new CommandResult { Status = "success" });

            var commandProcessor = new Mock<ICommandProcessor>();
            commandProcessor.Setup(p => p.ProcessAsync(It.IsAny<string>(), It.IsAny<CommandProcessorContext>()))
                .ReturnsAsync((string cmd, CommandProcessorContext ctx) => new CommandProcessorResult
                {
                    ShouldContinue = true,
                    Commands = [new ProcessedCommand { Command = cmd, IsOriginal = true }]
                });

            var context = new Mock<IServerContext>();
            var state = new ServerState
            {
                JobLoaded = new JobInfo { Filename = "test.gcode", TotalLines = 100, Status = "running" }
            };
            context.Setup(c => c.State).Returns(state);

            var broadcaster = new Mock<IBroadcaster>();
            broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
                .Returns(Task.CompletedTask);

            var processor = new GcodeJobProcessor(
                controller.Object, commandProcessor.Object, context.Object,
                NullLogger<JobManager>.Instance);

            // Pause then resume after a short delay
            _ = Task.Run(async () =>
            {
                await Task.Delay(10);
                processor.Pause();
                await Task.Delay(200);
                processor.Resume();
            });

            await processor.ProcessLinesAsync();

            // All 100 lines should eventually be processed after resume
            controller.Verify(c => c.SendCommandAsync(
                It.IsAny<string>(),
                It.IsAny<CommandOptions?>()), Times.Exactly(100));
        }
        finally
        {
            if (File.Exists(cachePath))
                File.Delete(cachePath);
        }
    }

    [Fact]
    public async Task ProcessLines_StripsExistingNNumbers()
    {
        var gcode = "N100 G0 X0\nN200 G1 X10 F500\n";
        var cachePath = SetupCacheFile(gcode);
        var sentCommands = new List<string>();

        try
        {
            var controller = new Mock<ICncController>();
            controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>()))
                .Callback<string, CommandOptions?>((cmd, _) => sentCommands.Add(cmd))
                .ReturnsAsync(new CommandResult { Status = "success" });

            var commandProcessor = new Mock<ICommandProcessor>();
            commandProcessor.Setup(p => p.ProcessAsync(It.IsAny<string>(), It.IsAny<CommandProcessorContext>()))
                .ReturnsAsync((string cmd, CommandProcessorContext ctx) => new CommandProcessorResult
                {
                    ShouldContinue = true,
                    Commands = [new ProcessedCommand { Command = cmd, IsOriginal = true }]
                });

            var context = new Mock<IServerContext>();
            var state = new ServerState
            {
                JobLoaded = new JobInfo { Filename = "test.gcode", TotalLines = 2, Status = "running" }
            };
            context.Setup(c => c.State).Returns(state);

            var broadcaster = new Mock<IBroadcaster>();
            broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>()))
                .Returns(Task.CompletedTask);

            var processor = new GcodeJobProcessor(
                controller.Object, commandProcessor.Object, context.Object,
                NullLogger<JobManager>.Instance);

            await processor.ProcessLinesAsync();

            // Old N-numbers stripped, new sequential ones added
            Assert.Equal(2, sentCommands.Count);
            Assert.Equal("N1 G0 X0", sentCommands[0]);
            Assert.Equal("N2 G1 X10 F500", sentCommands[1]);
        }
        finally
        {
            if (File.Exists(cachePath))
                File.Delete(cachePath);
        }
    }
}
