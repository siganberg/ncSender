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
        // Only the offsets are written back (UpdateOffsetsAsync), never the
        // whole tool: what tool changes see may carry a slot as the Tool ID.
        service.Setup(s => s.UpdateOffsetsAsync(It.IsAny<int>(), It.IsAny<double?>(), It.IsAny<double?>(), It.IsAny<double?>(), It.IsAny<double?>()))
            .ReturnsAsync((int id, double? _, double? _, double? _, double? _) => tools.FirstOrDefault(t => t.Id == id));
        return (new PendingToolTloWriteback(service.Object, NullLogger<PendingToolTloWriteback>.Instance), service);
    }

    [Fact]
    public void A_tool_in_a_slot_is_found_by_its_slot()
    {
        var inSlot4 = new ToolInfo { Id = 10, ToolNumber = 4, ToolId = 68 };
        var (writeback, service) = Create(inSlot4);

        writeback.Arm(4);
        writeback.Consume(12.5);

        service.Verify(s => s.UpdateOffsetsAsync(10, 12.5, null, null, null), Times.Once);
    }

    [Fact]
    public void A_tool_in_no_slot_is_found_by_its_tool_id()
    {
        var unslotted = new ToolInfo { Id = 11, ToolNumber = null, ToolId = 87 };
        var (writeback, service) = Create(unslotted);

        writeback.Arm(87);
        writeback.Consume(33.1);

        service.Verify(s => s.UpdateOffsetsAsync(11, 33.1, null, null, null), Times.Once);
    }

    [Fact]
    public void The_tool_id_wins_when_a_slot_matches_the_same_number()
    {
        // Tool-id concept: T4 is Tool 4, not whatever sits in slot 4.
        var inSlot4 = new ToolInfo { Id = 10, ToolNumber = 4, ToolId = 68 };
        var toolIdFour = new ToolInfo { Id = 12, ToolNumber = null, ToolId = 4 };
        var (writeback, service) = Create(inSlot4, toolIdFour);

        writeback.Arm(4);
        writeback.Consume(7.0);

        service.Verify(s => s.UpdateOffsetsAsync(12, It.IsAny<double?>(), null, null, null), Times.Once);
        service.Verify(s => s.UpdateOffsetsAsync(10, It.IsAny<double?>(), null, null, null), Times.Never);
    }

    [Fact]
    public void Nothing_is_written_when_no_tool_matches()
    {
        var (writeback, service) = Create(new ToolInfo { Id = 10, ToolNumber = 4, ToolId = 68 });

        writeback.Arm(99);
        writeback.Consume(1.0);

        service.Verify(s => s.UpdateOffsetsAsync(It.IsAny<int>(), It.IsAny<double?>(), It.IsAny<double?>(), It.IsAny<double?>(), It.IsAny<double?>()), Times.Never);
    }

    [Fact]
    public void A_stale_arm_does_not_take_the_next_measurement()
    {
        // Seen on the kiosk: T5's TLS alarmed before measuring, its arm stayed,
        // and the next measurement (for T1) was written to T5 as well.
        var t1 = new ToolInfo { Id = 1, ToolNumber = 1, ToolId = 1 };
        var t5 = new ToolInfo { Id = 10, ToolNumber = 3, ToolId = 5 };
        var (writeback, service) = Create(t1, t5);

        writeback.Arm(5);   // probe never finished
        writeback.Arm(1);
        writeback.Consume(-46.615);

        service.Verify(s => s.UpdateOffsetsAsync(1, It.IsAny<double?>(), null, null, null), Times.Once);
        service.Verify(s => s.UpdateOffsetsAsync(10, It.IsAny<double?>(), null, null, null), Times.Never);
    }
}
