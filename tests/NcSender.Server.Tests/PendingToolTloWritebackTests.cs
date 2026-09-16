using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Tools;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

public class PendingToolTloWritebackTests
{
    private static (PendingToolTloWriteback writeback, Mock<IToolService> service) Create(params ToolInfo[] tools)
    {
        var service = new Mock<IToolService>();
        service.Setup(s => s.GetAllAsync()).ReturnsAsync(tools.ToList());
        service.Setup(s => s.UpdateAsync(It.IsAny<int>(), It.IsAny<ToolInfo>()))
            .ReturnsAsync((int _, ToolInfo t) => t);
        return (new PendingToolTloWriteback(service.Object, NullLogger<PendingToolTloWriteback>.Instance), service);
    }

    [Fact]
    public void A_tool_in_a_slot_is_found_by_its_slot()
    {
        var inSlot4 = new ToolInfo { Id = 10, ToolNumber = 4, ToolId = 68 };
        var (writeback, service) = Create(inSlot4);

        writeback.Arm(4);
        writeback.Consume(12.5);

        service.Verify(s => s.UpdateAsync(10, It.Is<ToolInfo>(t => t.Offsets.Tlo == 12.5)), Times.Once);
    }

    [Fact]
    public void A_tool_in_no_slot_is_found_by_its_tool_id()
    {
        var unslotted = new ToolInfo { Id = 11, ToolNumber = null, ToolId = 87 };
        var (writeback, service) = Create(unslotted);

        writeback.Arm(87);
        writeback.Consume(33.1);

        service.Verify(s => s.UpdateAsync(11, It.Is<ToolInfo>(t => t.Offsets.Tlo == 33.1)), Times.Once);
    }

    [Fact]
    public void The_slot_wins_when_a_tool_id_matches_the_same_number()
    {
        var inSlot4 = new ToolInfo { Id = 10, ToolNumber = 4, ToolId = 68 };
        var toolIdFour = new ToolInfo { Id = 12, ToolNumber = null, ToolId = 4 };
        var (writeback, service) = Create(inSlot4, toolIdFour);

        writeback.Arm(4);
        writeback.Consume(7.0);

        service.Verify(s => s.UpdateAsync(10, It.IsAny<ToolInfo>()), Times.Once);
        service.Verify(s => s.UpdateAsync(12, It.IsAny<ToolInfo>()), Times.Never);
    }

    [Fact]
    public void Nothing_is_written_when_no_tool_matches()
    {
        var (writeback, service) = Create(new ToolInfo { Id = 10, ToolNumber = 4, ToolId = 68 });

        writeback.Arm(99);
        writeback.Consume(1.0);

        service.Verify(s => s.UpdateAsync(It.IsAny<int>(), It.IsAny<ToolInfo>()), Times.Never);
    }
}
