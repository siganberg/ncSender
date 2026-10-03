using System.Text.Json.Nodes;
using NcSender.Core.Interfaces;
using NcSender.Server.Tools;
using Moq;

namespace NcSender.Server.Tests;

// Tool Numbering decides what M6 T<n> names. Anything but an explicit Tool ID
// is Slot (classic): the default, and the safe reading of a missing or odd
// value. It also decides whether the Manual button (T<size + 1>) is offered,
// on screen and on the pendant.
public class ToolNumberingTests
{
    private static ISettingsManager With(string? value)
    {
        var s = new Mock<ISettingsManager>();
        s.Setup(x => x.GetSetting<string>(ToolNumbering.Setting, ToolNumbering.Slot))
            .Returns(value ?? ToolNumbering.Slot);
        return s.Object;
    }

    [Fact] public void Slot_is_classic() => Assert.True(ToolNumbering.IsSlot(With(ToolNumbering.Slot)));
    [Fact] public void Tool_ID_is_not() => Assert.False(ToolNumbering.IsSlot(With(ToolNumbering.ToolId)));
    [Fact] public void Missing_reads_as_Slot() => Assert.True(ToolNumbering.IsSlot(With(null)));
    [Fact] public void An_unknown_value_reads_as_Slot() => Assert.True(ToolNumbering.IsSlot(With("bogus")));

    [Fact]
    public void Real_settings_file_round_trip()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"ncsender-numbering-{Guid.NewGuid()}");
        Directory.CreateDirectory(dir);
        try
        {
            var settings = new NcSender.Server.Configuration.SettingsManager(Path.Combine(dir, "settings.json"));
            Assert.True(ToolNumbering.IsSlot(settings));                       // fresh install: classic
            settings.SaveSettings(new JsonObject { ["tool"] = new JsonObject { ["numbering"] = ToolNumbering.ToolId } }).Wait();
            Assert.False(ToolNumbering.IsSlot(settings));
        }
        finally { Directory.Delete(dir, true); }
    }

    private static ISettingsManager Setup(string numbering, string? source, int count)
    {
        var s = new Mock<ISettingsManager>();
        s.Setup(x => x.GetSetting<string>(ToolNumbering.Setting, ToolNumbering.Slot)).Returns(numbering);
        s.Setup(x => x.GetSetting<string>("tool.source", null)).Returns(source!);
        s.Setup(x => x.GetSetting<int>("tool.count", 0)).Returns(count);
        return s.Object;
    }

    [Fact]
    public void Manual_button_with_Slot_numbering_and_a_tool_changer_plugin() =>
        Assert.True(ToolNumbering.OffersManualTool(Setup(ToolNumbering.Slot, "com.ncsender.manualtoolchange", 0)));

    [Fact]
    public void Manual_button_with_Slot_numbering_and_a_magazine() =>
        Assert.True(ToolNumbering.OffersManualTool(Setup(ToolNumbering.Slot, null, 6)));

    [Fact]
    public void No_manual_button_without_any_tool_changer() =>
        Assert.False(ToolNumbering.OffersManualTool(Setup(ToolNumbering.Slot, null, 0)));

    [Fact]
    public void No_manual_button_with_Tool_ID_numbering() =>
        Assert.False(ToolNumbering.OffersManualTool(Setup(ToolNumbering.ToolId, "com.ncsender.rapidchangeatc", 6)));
}
