using NcSender.Core.Utils;

namespace NcSender.Server.Tests;

public class GcodePatternTests
{
    // --- M6 Parsing ---

    [Theory]
    [InlineData("M6", true, null)]
    [InlineData("M06", true, null)]
    [InlineData("M6 T3", true, 3)]
    [InlineData("M06T12", true, 12)]
    [InlineData("T3 M6", true, 3)]
    [InlineData("T3M06", true, 3)]
    [InlineData("m6 t5", true, 5)]
    [InlineData("M6 T01", true, 1)]
    [InlineData("M006 T2", true, 2)]
    [InlineData("G0 X10", false, null)]
    [InlineData("G1 X10 F500", false, null)]
    // Must NOT match M60, M61, M600 etc.
    [InlineData("M60", false, null)]
    [InlineData("M61", false, null)]
    [InlineData("M61Q2", false, null)]
    [InlineData("M600", false, null)]
    // Must NOT match commented M6
    [InlineData("; M6 T1", false, null)]
    [InlineData("(M6 T1)", false, null)]
    [InlineData("N16 ;M6 T3", false, null)]
    public void ParseM6Command_DetectsToolChange(string line, bool expectedMatch, int? expectedTool)
    {
        var result = GcodePatterns.ParseM6Command(line);
        Assert.Equal(expectedMatch, result.Matched);
        Assert.Equal(expectedTool, result.ToolNumber);
    }

    // --- Same-Tool Check ---

    [Fact]
    public void CheckSameToolChange_SameTool_ReturnsTrue()
    {
        var result = GcodePatterns.CheckSameToolChange("M6 T3", currentTool: 3);
        Assert.True(result.IsM6);
        Assert.True(result.IsSameTool);
        Assert.Equal(3, result.ToolNumber);
    }

    [Fact]
    public void CheckSameToolChange_DifferentTool_ReturnsFalse()
    {
        var result = GcodePatterns.CheckSameToolChange("M6 T5", currentTool: 3);
        Assert.True(result.IsM6);
        Assert.False(result.IsSameTool);
        Assert.Equal(5, result.ToolNumber);
    }

    [Fact]
    public void CheckSameToolChange_NoToolNumber_ReturnsFalse()
    {
        var result = GcodePatterns.CheckSameToolChange("M6", currentTool: 3);
        Assert.True(result.IsM6);
        Assert.False(result.IsSameTool);
    }

    [Fact]
    public void CheckSameToolChange_NonM6_ReturnsFalse()
    {
        var result = GcodePatterns.CheckSameToolChange("G0 X10", currentTool: 3);
        Assert.False(result.IsM6);
        Assert.False(result.IsSameTool);
    }

    // --- Spindle Detection ---

    [Theory]
    [InlineData("M3", true)]
    [InlineData("M03", true)]
    [InlineData("M4", true)]
    [InlineData("M04", true)]
    [InlineData("M3 S12000", true)]
    [InlineData("m3 s12000", true)]
    [InlineData("M5", false)]
    [InlineData("G0 X10", false)]
    // Must NOT match M30, M40
    [InlineData("M30", false)]
    [InlineData("M40", false)]
    [InlineData("M31", false)]
    public void IsSpindleStartCommand_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsSpindleStartCommand(line));
    }

    // --- Spindle Stop Detection ---

    [Theory]
    [InlineData("M5", true)]
    [InlineData("M05", true)]
    [InlineData("M50", false)]
    [InlineData("M51", false)]
    public void IsSpindleStopCommand_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsSpindleStopCommand(line));
    }

    // --- M98 Detection ---

    [Theory]
    [InlineData("M98 P1234", true)]
    [InlineData("m98 p5", true)]
    [InlineData("M98P100", true)]   // no space before P — V1 pattern allows this
    [InlineData("M098P100", true)]  // leading zero
    [InlineData("G0 X10", false)]
    // Must NOT match M980
    [InlineData("M980", false)]
    // Must NOT match commented M98
    [InlineData("; M98 P100", false)]
    [InlineData("(M98 P100)", false)]
    public void IsM98Command_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsM98Command(line));
    }

    // --- M98 Parsing ---

    [Theory]
    [InlineData("M98 P9001", true, 9001)]
    [InlineData("M98P9002", true, 9002)]
    [InlineData("M098 P100", true, 100)]
    [InlineData("G0 X10", false, null)]
    public void ParseM98Command_ExtractsMacroId(string line, bool expectedMatch, int? expectedMacroId)
    {
        var result = GcodePatterns.ParseM98Command(line);
        Assert.Equal(expectedMatch, result.Matched);
        Assert.Equal(expectedMacroId, result.MacroId);
    }

    // --- Comment Detection ---

    [Theory]
    [InlineData("(this is a comment)", true)]
    [InlineData("; this is a comment", true)]
    [InlineData("", true)]
    [InlineData("   ", true)]
    [InlineData("G0 X10", false)]
    [InlineData("G1 X10 (inline comment)", false)]  // not a full-line comment
    [InlineData("(M6 T1)", true)]                    // entire line in parens = comment
    [InlineData("N16 ;M6 T3", true)]                 // N-number + semicolon = comment
    public void IsGcodeComment_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsGcodeComment(line));
    }

    // --- N-Number Stripping ---

    [Theory]
    [InlineData("N100 G0 X10", "G0 X10")]
    [InlineData("N1G1 X5", "G1 X5")]
    [InlineData("G0 X10", "G0 X10")]
    [InlineData("n50 M3", "M3")]
    public void StripNNumber_Strips(string line, string expected)
    {
        Assert.Equal(expected, GcodePatterns.StripNNumber(line));
    }

    // --- Rapid/Feed Move Detection ---

    [Theory]
    [InlineData("G0 X10", true)]
    [InlineData("G00 X10", true)]
    [InlineData("G1 X10", false)]
    // Must NOT match G09
    [InlineData("G09 X10", false)]
    public void IsRapidMove_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsRapidMove(line));
    }

    [Theory]
    [InlineData("G1 X10 F500", true)]
    [InlineData("G2 X10 Y10 I5 J5", true)]
    [InlineData("G3 X10 Y10 I5 J5", true)]
    [InlineData("G0 X10", false)]
    [InlineData("M3 S12000", false)]
    public void IsFeedMove_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsFeedMove(line));
    }

    // --- Jog Command Detection ---

    [Theory]
    [InlineData("$J=G21G91X10F1000", true)]
    [InlineData("$j=G21X5", true)]
    [InlineData("G0 X10", false)]
    public void IsJogCommand_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsJogCommand(line));
    }

    // --- TLS Command Detection ---

    [Theory]
    [InlineData("$TLS", true)]
    [InlineData("$tls", true)]
    [InlineData(" $TLS ", true)]
    [InlineData("$TLSX", false)]
    [InlineData("G0 X10", false)]
    public void IsTlsCommand_Detects(string line, bool expected)
    {
        Assert.Equal(expected, GcodePatterns.IsTlsCommand(line));
    }

    // --- Feed Rate Clamping ---

    [Fact]
    public void ClampFeedRate_OverMax_Clamps()
    {
        var result = GcodePatterns.ClampFeedRate("G1 X10 F2000", 1000);
        Assert.Contains("F1000", result);
        Assert.DoesNotContain("F2000", result);
    }

    [Fact]
    public void ClampFeedRate_UnderMax_Unchanged()
    {
        var result = GcodePatterns.ClampFeedRate("G1 X10 F500", 1000);
        Assert.Contains("F500", result);
    }

    [Fact]
    public void ClampFeedRate_NoFeed_Unchanged()
    {
        var result = GcodePatterns.ClampFeedRate("G1 X10", 1000);
        Assert.Equal("G1 X10", result);
    }

    // --- Feed Rate Limiting ---

    [Fact]
    public void LimitFeedRate_JogNoFeed_AddsFeedRate()
    {
        var result = GcodePatterns.LimitFeedRate("$J=G21G91X10", 1000);
        Assert.True(result.WasLimited);
        Assert.Contains("F1000", result.Command);
    }

    [Fact]
    public void LimitFeedRate_JogOverMax_Clamps()
    {
        var result = GcodePatterns.LimitFeedRate("$J=G21G91X10F5000", 1000);
        Assert.True(result.WasLimited);
        Assert.Contains("F1000", result.Command);
        Assert.DoesNotContain("F5000", result.Command);
    }

    // --- Firmware Setting Parsing ---

    [Theory]
    [InlineData("$32=1", true, "32", "1")]
    [InlineData("$100=800.000", true, "100", "800.000")]
    [InlineData("G0 X10", false, null, null)]
    public void ParseFirmwareSetting_Parses(string line, bool expectedMatch, string? expectedId, string? expectedValue)
    {
        var result = GcodePatterns.ParseFirmwareSetting(line);
        Assert.Equal(expectedMatch, result.Matched);
        Assert.Equal(expectedId, result.SettingId);
        Assert.Equal(expectedValue, result.Value);
    }
}
