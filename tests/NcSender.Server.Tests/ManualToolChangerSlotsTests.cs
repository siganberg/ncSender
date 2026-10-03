using System.Text.Json;
using NcSender.Server.Plugins;

namespace NcSender.Server.Tests;

// The Manual Tool Changer has slots only with RapidChangeSolo: its Magazine
// Size. Tools in a slot go through the Solo, anything else is a hand swap.
public class ManualToolChangerSlotsTests
{
    private static Dictionary<string, JsonElement> Settings(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    [Fact]
    public void Solo_on_the_magazine_size_is_the_slot_count() =>
        Assert.Equal(6, PluginManager.ManualToolChangerSlots(Settings("""{"autoSwap":true,"numberOfTools":6}""")));

    [Fact]
    public void Solo_off_there_are_no_slots() =>
        Assert.Equal(0, PluginManager.ManualToolChangerSlots(Settings("""{"autoSwap":false,"numberOfTools":6}""")));

    [Fact]
    public void Solo_on_without_a_size_yet_has_no_slots() =>
        Assert.Equal(0, PluginManager.ManualToolChangerSlots(Settings("""{"autoSwap":true}""")));

    [Fact]
    public void A_size_saved_as_text_still_counts() =>
        Assert.Equal(4, PluginManager.ManualToolChangerSlots(Settings("""{"autoSwap":true,"numberOfTools":"4"}""")));
}
