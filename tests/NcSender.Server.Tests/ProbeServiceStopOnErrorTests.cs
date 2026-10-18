using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Probing;

namespace NcSender.Server.Tests;

/// <summary>
/// A probe routine is a chain of dependent lines (units, offsets, retract).
/// Once the controller rejects one, nothing after it may be sent.
/// </summary>
public class ProbeServiceStopOnErrorTests
{
    [Fact]
    public async Task RejectedLine_StopsTheRoutine()
    {
        var sent = new List<string>();
        var controller = new Mock<ICncController>();
        controller.SetupGet(c => c.IsConnected).Returns(true);
        controller.Setup(c => c.SendCommandAsync(It.IsAny<string>(), It.IsAny<CommandOptions?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string cmd, CommandOptions? _, CancellationToken _) =>
            {
                sent.Add(cmd);
                return new CommandResult { Command = cmd, Status = cmd.StartsWith("#") ? "error" : "success", ErrorMessage = "error:20" };
            });
        var context = new Mock<IServerContext>();
        context.SetupGet(c => c.State).Returns(new ServerState());
        var broadcaster = new Mock<IBroadcaster>();
        broadcaster.Setup(b => b.Broadcast(It.IsAny<string>(), It.IsAny<JsonElement>())).Returns(Task.CompletedTask);

        var service = new ProbeService(controller.Object, context.Object, broadcaster.Object, NullLogger<ProbeService>.Instance);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.StartAsync(null, ["G21", "#<units> = [20 + #<_metric>]", "G38.2 Z-10 F100", "G0 Z5"]));

        Assert.Contains("#<units>", ex.Message);
        Assert.Equal(new[] { "G21", "#<units> = [20 + #<_metric>]" }, sent);
        Assert.False(context.Object.State.MachineState.IsProbing);
    }
}
