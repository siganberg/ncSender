using NcSender.Core.Models;
using NcSender.Server.Accessories;
using NcSender.Server.Dongle;
using Xunit;

namespace NcSender.Server.Tests;

public class NcRapidChangeTests
{
    [Fact]
    public void State_frame_and_cover_give_sensors_and_cover()
    {
        var s = NcRapidChange.ParseState("2:S:41:R", "$COVER:1 open");
        Assert.False(s.Tls);
        Assert.True(s.Ir);
        Assert.True(s.CoverOpen);
        Assert.True(s.HasCover);
        Assert.True(s.Awake);

        var asleep = NcRapidChange.ParseState("$SLEEP", "$COVER:0 closed");
        Assert.False(asleep.Awake);
        Assert.False(asleep.HasCover);
        Assert.False(asleep.CoverOpen);
    }

    [Theory]
    [InlineData("@ncrapidchange 1:S:7:R", "1:S:7:R")]      // on the cable
    [InlineData("3:S:8:R", "3:S:8:R")]                     // over the radio
    [InlineData("$SLEEP", "$SLEEP")]
    [InlineData("0:H:9:B3900:R", null)]                    // a heartbeat is not the answer
    [InlineData("@ncrapidchange 1:E:10:R", null)]          // nor an edge
    [InlineData("$COVER:1 open", null)]
    public void Only_the_status_answer_is_taken_as_state(string line, string? frame)
    {
        Assert.Equal(frame, NcRapidChange.StateFrame(line));
    }

    [Fact]
    public void Setting_replies_are_read()
    {
        Assert.True(NcRapidChange.ParseHasCover("$COVER:1 open"));
        Assert.False(NcRapidChange.ParseHasCover("$COVER:0 closed"));
        Assert.Equal((2000, 1000), NcRapidChange.ParseServo("$SERVO:F:2000:1000"));
        Assert.Equal((true, false), NcRapidChange.ParseInvert("$INV:1:0"));
        Assert.Equal(800, NcRapidChange.ParseInt("$MOVE:800", "$MOVE:"));
    }

    [Fact]
    public void A_servo_error_is_not_read_as_positions()
    {
        Assert.Throws<InvalidOperationException>(() => NcRapidChange.ParseServo("$SERVO:ERR cover disabled ($COVER:1)"));
    }

    [Theory]
    [InlineData(499, 1000)]
    [InlineData(2000, 2501)]
    public void Servo_positions_outside_the_range_are_refused(int open, int close)
    {
        Assert.NotNull(NcRapidChange.Validate(new RapidChangeSettingsRequest(null, open, close, null, null, null, null, null, null)));
    }

    [Fact]
    public void Half_a_servo_is_refused_and_a_whole_change_passes()
    {
        Assert.NotNull(NcRapidChange.Validate(new RapidChangeSettingsRequest(null, 1500, null, null, null, null, null, null, null)));
        Assert.NotNull(NcRapidChange.Validate(new RapidChangeSettingsRequest(null, null, null, null, null, 50, null, null, null)));
        Assert.NotNull(NcRapidChange.Validate(new RapidChangeSettingsRequest(null, null, null, null, null, null, null, null, 51)));
        Assert.Null(NcRapidChange.Validate(new RapidChangeSettingsRequest(true, 2000, 1000, 1900, 1100, 800, true, true, 2)));
    }

    // The heartbeat carries the battery in the same words as the wireless probes.
    [Theory]
    [InlineData("0:H:41:B3910:R", "3910")]
    [InlineData("2:H:42:BC4120:R", "C4120")]
    [InlineData("0:H:43:BU:R", "U")]
    public void Heartbeat_battery_field_is_found(string frame, string token)
    {
        Assert.Equal(token, BatteryReading.Token(frame));
    }
}
