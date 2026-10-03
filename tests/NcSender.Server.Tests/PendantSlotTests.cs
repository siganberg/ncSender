using NcSender.Core.Models;
using NcSender.Server.Pendant;

namespace NcSender.Server.Tests;

// A slot loads the tool assigned to it, and nothing otherwise: no fallback to
// "T<slot>", which with the Tool Library on means the tool with that ID.
public class PendantSlotTests
{
    [Fact]
    public void A_slot_loads_its_assigned_tool_by_Tool_ID()
    {
        var tools = new List<ToolInfo> { new() { Id = 7, ToolId = 300, ToolNumber = 1 } };

        Assert.Equal(300, PendantManager.ToolForSlot(tools, 1));
    }

    [Fact]
    public void An_empty_slot_loads_nothing()
    {
        Assert.Null(PendantManager.ToolForSlot(new List<ToolInfo>(), 1));
    }

    [Fact]
    public void An_empty_slot_loads_nothing_even_when_no_tool_has_its_number()
    {
        // Used to send M6 T1 here.
        var tools = new List<ToolInfo> { new() { Id = 2, ToolId = 2, ToolNumber = null } };

        Assert.Null(PendantManager.ToolForSlot(tools, 1));
    }

    [Fact]
    public void Built_in_library_every_slot_loads_its_own_number()
    {
        // Tool Library off: ToolService hands out Tool N in slot N (negative Ids).
        var tools = Enumerable.Range(1, 4).Select(n => new ToolInfo { Id = -n, ToolId = n, ToolNumber = n }).ToList();

        Assert.Equal(new int?[] { 1, 2, 3, 4 }, Enumerable.Range(1, 4).Select(n => PendantManager.ToolForSlot(tools, n)));
    }
}
