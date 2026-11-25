using NcSender.Core.Models;
using NcSender.Server.Connection;

namespace NcSender.Server.Tests;

/// <summary>
/// A plugin prompt that gives a heading is drawn by the app as a step list.
/// These cover what the app is handed to draw it from.
/// </summary>
public class StepListPromptTests
{
    private static PluginDialogInfo Dialog(string? heading) => new()
    {
        Title = "Manual Swap",
        Heading = heading,
        ContinueNote = "Check that the tool is seated before you continue.",
        Buttons =
        [
            new() { Label = "Release", Task = "Open the drawbar", Done = "Drawbar open" },
            new() { Label = "Clamp", Task = "Insert {toolNumber}, then close the drawbar" },
        ],
    };

    [Fact]
    public void A_prompt_without_a_heading_keeps_its_sentence()
    {
        Assert.Null(CncEventBridge.StepListData(Dialog(null), 5, "Ball nose"));
    }

    [Fact]
    public void A_heading_gives_the_step_list_its_lines_and_the_tool()
    {
        var data = CncEventBridge.StepListData(Dialog("Swap to this tool"), 13, "End Mill")!;

        Assert.Equal("steps", data["kind"]);
        Assert.Equal("Swap to this tool", data["heading"]);
        Assert.Equal("T13", data["toolId"]);
        Assert.Equal("End Mill", data["toolName"]);
        Assert.Equal("Open the drawbar", data["step0.task"]);
        Assert.Equal("Drawbar open", data["step0.done"]);
        Assert.Equal("Insert T13, then close the drawbar", data["step1.task"]);
        Assert.False(data.ContainsKey("step1.done"));
        Assert.False(data.ContainsKey("continueTask"));
        Assert.True(data.ContainsKey("continueNote"));
    }

    [Fact]
    public void With_no_tool_in_the_message_the_lines_say_the_tool()
    {
        var data = CncEventBridge.StepListData(Dialog("Swap to this tool"), null, null)!;

        Assert.False(data.ContainsKey("toolId"));
        Assert.False(data.ContainsKey("toolName"));
        Assert.Equal("Insert the tool, then close the drawbar", data["step1.task"]);
    }
}
