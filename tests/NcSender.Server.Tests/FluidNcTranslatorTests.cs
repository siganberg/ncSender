using NcSender.Core.Interfaces;
using NcSender.Server.Protocols.FluidNc;

namespace NcSender.Server.Tests;

/// <summary>
/// FluidNC runs as grblHAL: what ncSender (and the plugins) send is changed
/// only where FluidNC can't run it, and what FluidNC reports is turned into
/// grblHAL's form. Report lines below were recorded from FluidNC v4.0.3.
/// </summary>
public class FluidNcTranslatorTests
{
    private readonly FluidNcTranslator _t = new();

    // A new translator starts just after ncSender's connect reset: the first
    // line reads the units and the offset back before it goes out.
    public FluidNcTranslatorTests() => Settle();

    private void Settle(double tlo = 0, string units = "G21")
    {
        Assert.Equal("$G", _t.Translate("G4 P0").SyncCommand);
        _t.ObserveData($"[GC:G0 G54 G17 {units} G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("$#", _t.Translate("G4 P0").SyncCommand);
        _t.ObserveData($"[TLO:0.000,0.000,{tlo.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture)}]");
        var next = _t.Translate("G4 P0");
        if (Math.Abs(tlo) > 0.0005) Assert.Equal(TranslationKind.Sync, next.Kind);
        else Assert.Equal("G4 P0", Written(next));
    }

    private static string? Written(TranslationResult r) =>
        r is { Kind: TranslationKind.Run, Steps: [{ Write: { } line, Message: null }] } ? line : null;

    private string Report(string line) => _t.CorrectReport(line)!;

    // ---- sent ----

    [Theory]
    [InlineData("G1 X10 Y20 F500")]
    [InlineData("G53 G0 X[100+#<_nctest>]")]
    [InlineData("#<return_spov> = #<_speed_override>")]
    [InlineData("o100 if [#5399 EQ -1]")]
    [InlineData("M66 P0 L3 Q5")]
    [InlineData("M64 P1")]
    [InlineData("G10 L2 P[#5220] Z[#<_nc_z>]")]
    [InlineData("G43.1 Z[#<_nc_last_tlo>]")]
    [InlineData("$H")]
    [InlineData("$#")]
    [InlineData("$J=G91 G21 X10 F1000")]
    [InlineData("(MSG, TOOL_CHANGE_START 3)")]
    [InlineData("X5 Y-2.5")]
    public void Lines_FluidNcRuns_GoOutUnchanged(string line) =>
        Assert.Equal(line, Written(_t.Translate(line)));

    [Theory]
    [InlineData("M51 P0")]
    [InlineData("M51 P[#<return_spov>]")]
    [InlineData("m51 p1")]
    [InlineData("M51 P0 (hold the override)")]
    public void OverrideControl_IsDropped(string line)
    {
        var r = _t.Translate(line);
        Assert.Equal(TranslationKind.Run, r.Kind);
        Assert.Empty(r.Steps);
    }

    [Fact]
    public void OverrideControl_OnALineWithMore_KeepsTheRest() =>
        Assert.Equal("G4 P0", Written(_t.Translate("M51 P0 G4 P0")));

    [Fact]
    public void M510_IsNotOverrideControl() =>
        Assert.Equal("M510", Written(_t.Translate("M510")));

    [Fact]
    public void SpindleAtSpeedSkip_IsDropped() =>
        Assert.Empty(_t.Translate("G65 P6").Steps);

    [Fact]
    public void OtherG65Macros_Fail()
    {
        var r = _t.Translate("G65 P100");
        Assert.Equal(TranslationKind.Fail, r.Kind);
        Assert.Contains("G65", r.Error);
    }

    [Theory]
    [InlineData("G0 X-[#<a>-#<b>]", "G0 X[-[#<a>-#<b>]]")]
    [InlineData("G0 X-[[#<X1>+#<X2>]/2] Y-[2]", "G0 X[-[[#<X1>+#<X2>]/2]] Y[-[2]]")]
    [InlineData("G0 X[#<a>-[#<b>]]", "G0 X[#<a>-[#<b>]]")]
    [InlineData("G0 X-[1] (keep -[this])", "G0 X[-[1]] (keep -[this])")]
    public void MinusBeforeABracket_MovesInside(string line, string expected) =>
        Assert.Equal(expected, Written(_t.Translate(line)));

    [Fact]
    public void AlarmList_IsAskedWithDollarA() =>
        Assert.Equal("$A", Written(_t.Translate("$EA")));

    [Theory]
    [InlineData("$EE")]
    [InlineData("$EG")]
    [InlineData("$ES")]
    [InlineData("$ESH")]
    [InlineData("$pinstate")]
    public void GrblHalOnlyLists_AreAnsweredWithoutTheController(string line)
    {
        var r = _t.Translate(line);
        Assert.Equal(TranslationKind.Run, r.Kind);
        Assert.Empty(r.Steps);
    }

    [Fact]
    public void ToolOffsetQuery_ReadsTheOffsetsFirst_ThenAnswersLikeGrblHal()
    {
        // A tool setter run ends with the measured offset going in.
        _t.Translate("G43.1 Z[#<_nc_last_tlo>]");
        var first = _t.Translate("$#=_tool_offset");
        Assert.Equal(TranslationKind.Sync, first.Kind);
        Assert.Equal("$#", first.SyncCommand);

        _t.ObserveData("[G54:68.284,-379.903,-39.500]");
        _t.ObserveData("[TLO:0.000,0.000,2.250]");
        _t.ObserveData("ok");

        var answer = _t.Translate("$#=_tool_offset");
        Assert.Equal("[PARAM:_TOOL_OFFSET=1]", Assert.Single(answer.Steps).Message);
    }

    [Fact]
    public void ToolOffsetQuery_NoOffset_ReportsNotSet()
    {
        _t.Translate("$#=_TOOL_OFFSET");
        _t.ObserveData("[TLO:0.000,0.000,0.000]");
        Assert.Equal("[PARAM:_TOOL_OFFSET=0]", Assert.Single(_t.Translate("$#=_TOOL_OFFSET").Steps).Message);
    }

    // G43.1 Z0 is an offset in effect too (a tool exactly as long as the reference).
    [Fact]
    public void ToolOffsetQuery_ZeroOffsetSetWithG431_ReportsSet()
    {
        _t.Translate("G43.1 Z0");
        _t.Translate("$#=_tool_offset");
        _t.ObserveData("[TLO:0.000,0.000,0.000]");
        Assert.Equal("[PARAM:_TOOL_OFFSET=1]", Assert.Single(_t.Translate("$#=_tool_offset").Steps).Message);

        _t.Translate("G49");
        _t.Translate("$#=_tool_offset");
        _t.ObserveData("[TLO:0.000,0.000,0.000]");
        Assert.Equal("[PARAM:_TOOL_OFFSET=0]", Assert.Single(_t.Translate("$#=_tool_offset").Steps).Message);
    }

    // The answer must come from the $# sent for it, not an older [TLO:].
    [Fact]
    public void ToolOffsetQuery_ReplyWithoutTlo_ReportsNotSet()
    {
        _t.ObserveData("[TLO:0.000,0.000,5.000]");
        _t.Translate("$#=_tool_offset");
        _t.ObserveData("ok");
        Assert.Equal("[PARAM:_TOOL_OFFSET=0]", Assert.Single(_t.Translate("$#=_tool_offset").Steps).Message);
    }

    [Fact]
    public void ToolOffsetQuery_SyncFails_StartsOverNextTime()
    {
        _t.Translate("$#=_tool_offset");
        _t.OnLineFailed();
        Assert.Equal(TranslationKind.Sync, _t.Translate("$#=_tool_offset").Kind);
    }

    [Theory]
    [InlineData("$#=5063", "(PRINT, NCSENDER_PARAM 5063=#5063)")]
    [InlineData("$#=_metric", "(PRINT, NCSENDER_PARAM _metric=#<_metric>)")]
    public void ParameterQuery_IsPrinted(string line, string expected) =>
        Assert.Equal(expected, Written(_t.Translate(line)));

    [Fact]
    public void ParameterPrint_IsReportedAsGrblHalParam() =>
        Assert.Equal("[PARAM:5063=-12.345]", Report("[MSG:INFO: PRINT, NCSENDER_PARAM 5063=-12.345000]"));

    // ncSender resets FluidNC as it connects; the offset it had (still in $#)
    // goes back, so a measured tool stays measured, as on grblHAL.
    [Fact]
    public void Connect_PutsTheOffsetBack()
    {
        var t = new FluidNcTranslator();
        Assert.Equal("$G", t.Translate("$G").SyncCommand);
        t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("$#", t.Translate("$G").SyncCommand);
        t.ObserveData("[TLO:0.000,0.000,-109.500]");
        Assert.Equal("G43.1 Z-109.5", t.Translate("$G").SyncCommand);
        Assert.Equal("$G", Written(t.Translate("$G")));

        Assert.Equal("$#", t.Translate("$#=_tool_offset").SyncCommand);
        t.ObserveData("[TLO:0.000,0.000,-109.500]");
        Assert.Equal("[PARAM:_TOOL_OFFSET=1]", Assert.Single(t.Translate("$#=_tool_offset").Steps).Message);
    }

    // After a power cycle there is no offset to put back.
    [Fact]
    public void Connect_WithoutAnOffset_PutsNothingBack()
    {
        var t = new FluidNcTranslator();
        t.Translate("$G");
        t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        t.Translate("$G");
        t.ObserveData("[TLO:0.000,0.000,0.000]");
        Assert.Equal("$G", Written(t.Translate("$G")));
    }

    // grblHAL keeps the offset through a reset: so does FluidNC, through here.
    [Fact]
    public void Reset_PutsTheOffsetBack_BeforeTheNextLine_AndHoldsTheDro()
    {
        _t.Translate("G43.1 Z3");
        _t.ObserveData("[TLO:0.000,0.000,3.000]");
        Report("<Idle|MPos:0,0,0|FS:0,0|WCO:68.284,-379.903,-36.500>");

        _t.Reset();
        // Until the offset is back, the WCO still has it.
        Assert.Contains("|WCO:68.284,-379.903,-36.500|", Report("<Idle|MPos:0,0,0|FS:0,0|WCO:68.284,-379.903,-39.500>"));

        Assert.Equal("$G", _t.Translate("G0 X1").SyncCommand);
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("$#", _t.Translate("G0 X1").SyncCommand);
        _t.ObserveData("[TLO:0.000,0.000,3.000]");
        Assert.Equal("G43.1 Z3", _t.Translate("G0 X1").SyncCommand);
        Assert.Equal("G0 X1", Written(_t.Translate("G0 X1")));

        // FluidNC's WCO has it again: reported as it is from here.
        Assert.Contains("|WCO:68.284,-379.903,-36.500|", Report("<Idle|MPos:0,0,0|FS:0,0|WCO:68.284,-379.903,-36.500>"));
        Assert.Contains("|WCO:68.284,-379.903,-40.000|", Report("<Idle|MPos:0,0,0|FS:0,0|WCO:68.284,-379.903,-40.000>"));
    }

    // The value comes from $# after the reset, not from what was known before
    // it: a G43.1 with an expression may not have been read back yet.
    [Fact]
    public void Reset_PutsBackTheOffsetFluidNcLists()
    {
        _t.Translate("G43.1 Z[#<_nc_last_tlo>]");
        _t.Reset();
        _t.Translate("G0 X1");
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        _t.Translate("G0 X1");
        _t.ObserveData("[TLO:0.000,0.000,-12.345]");
        Assert.Equal("G43.1 Z-12.345", _t.Translate("G0 X1").SyncCommand);
    }

    [Fact]
    public void Reset_AfterG49_PutsNothingBack()
    {
        _t.Translate("G49");
        _t.Reset();
        _t.Translate("G0 X1");
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        _t.Translate("G0 X1");
        _t.ObserveData("[TLO:0.000,0.000,0.000]");
        Assert.Equal("G0 X1", Written(_t.Translate("G0 X1")));
    }

    [Fact]
    public void Reset_IntoAnAlarm_WaitsForItToClear()
    {
        _t.Reset();
        Report("<Alarm|MPos:0,0,0|FS:0,0>");
        Assert.Equal("$X", Written(_t.Translate("$X")));
        Report("<Idle|MPos:0,0,0|FS:0,0>");
        Assert.Equal("$G", _t.Translate("G0 X1").SyncCommand);
    }

    [Fact]
    public void Reset_CoolantLine_GoesOutWithoutWaiting()
    {
        _t.Reset();
        Assert.Equal("M8", Written(_t.Translate("M8")));
        Assert.Equal("M64 P1", Written(_t.Translate("M64 P1")));
    }

    [Fact]
    public void Reset_RestoreThatFails_IsTriedAgain()
    {
        _t.Reset();
        _t.Translate("G0 X1");
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        _t.Translate("G0 X1");
        _t.ObserveData("[TLO:0.000,0.000,3.000]");
        Assert.Equal("G43.1 Z3", _t.Translate("G0 X1").SyncCommand);
        _t.OnLineFailed();
        Assert.Equal("$#", _t.Translate("G0 X1").SyncCommand);
        _t.ObserveData("[TLO:0.000,0.000,3.000]");
        Assert.Equal("G43.1 Z3", _t.Translate("G0 X1").SyncCommand);
    }

    // grblHAL keeps the current tool through a reset; FluidNC goes to T0.
    [Fact]
    public void Reset_PutsTheToolBack_AndReadsItBack()
    {
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T2 F0 S0]");
        _t.Reset();
        Assert.Equal("$G", _t.Translate("G0 X1").SyncCommand);
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("M61 Q2", _t.Translate("G0 X1").SyncCommand);
        Assert.Equal("$G", _t.Translate("G0 X1").SyncCommand);
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T2 F0 S0]");
        Assert.Equal("$#", _t.Translate("G0 X1").SyncCommand);
        _t.ObserveData("[TLO:0.000,0.000,0.000]");
        Assert.Equal("G0 X1", Written(_t.Translate("G0 X1")));
    }

    [Fact]
    public void Reset_KeepsTheToolFluidNcStillHas()
    {
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T2 F0 S0]");
        _t.Reset();
        _t.Translate("G0 X1");
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T2 F0 S0]");
        Assert.Equal("$#", _t.Translate("G0 X1").SyncCommand);
    }

    [Fact]
    public void Reset_WithNoToolLoaded_PutsNoToolBack()
    {
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        _t.Reset();
        _t.Translate("G0 X1");
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("$#", _t.Translate("G0 X1").SyncCommand);
    }

    // A restart of ncSender (its connect reset): the tool comes from the file.
    [Fact]
    public void Connect_PutsTheKeptToolBack()
    {
        var file = Path.Combine(Path.GetTempPath(), $"fluidnc-tool-{Guid.NewGuid():N}.txt");
        try
        {
            var before = new FluidNcTranslator(file);
            before.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T3 F0 S0]");

            var after = new FluidNcTranslator(file);
            Assert.Equal("$G", after.Translate("$G").SyncCommand);
            after.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
            Assert.Equal("M61 Q3", after.Translate("$G").SyncCommand);
        }
        finally { File.Delete(file); }
    }

    [Fact]
    public void ToolUnloaded_IsKeptUnloaded()
    {
        var file = Path.Combine(Path.GetTempPath(), $"fluidnc-tool-{Guid.NewGuid():N}.txt");
        try
        {
            var t = new FluidNcTranslator(file);
            t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T3 F0 S0]");
            t.Translate("G4 P0");
            t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T3 F0 S0]");
            t.Translate("G4 P0");
            t.ObserveData("[TLO:0.000,0.000,0.000]");
            t.Translate("M61 Q0");
            t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
            Assert.Equal("0", File.ReadAllText(file).Trim());
        }
        finally { File.Delete(file); }
    }

    // In inches when FluidNC is in G20 (it lists the offset in mm).
    [Fact]
    public void Reset_PutsTheOffsetBackInTheCurrentUnits()
    {
        _t.Reset();
        _t.Translate("G0 X1");
        _t.ObserveData("[GC:G0 G54 G17 G20 G90 G94 M5 M9 T0 F0 S0]");
        _t.Translate("G0 X1");
        _t.ObserveData("[TLO:0.000,0.000,25.400]");
        Assert.Equal("G43.1 Z1", _t.Translate("G0 X1").SyncCommand);
    }

    // ---- reported ----

    [Fact]
    public void Status_GetsHomedAndMeasuredSpeedFields() =>
        Assert.Equal("<Idle|MPos:105.000,-100.000,-5.000|FS:0,0,0|WCO:68.284,-379.903,-39.500|H:1>",
            Report("<Idle|MPos:105.000,-100.000,-5.000|FS:0,0|WCO:68.284,-379.903,-39.500>"));

    [Fact]
    public void Status_OwnWcoIsKept() =>
        Assert.Contains("|WCO:68.284,-379.903,-39.500|", Report("<Run|MPos:1,2,3|Ln:7|FS:600,0|WCO:68.284,-379.903,-39.500>"));

    [Fact]
    public void Status_WithoutWco_GetsNoneMadeUp() =>
        Assert.DoesNotContain("WCO", Report("<Run|MPos:1,2,3|Ln:7|FS:600,0>"));

    [Fact]
    public void MeasuredSpeed_FillsFs_AndTheMessageIsDropped()
    {
        Report("<Run|MPos:0,0,0|FS:500,6000>");
        Assert.Null(_t.CorrectReport("[MSG:INFO: Current speed is 5982]"));
        Assert.Contains("|FS:500,6000,5982", Report("<Run|MPos:0,0,0|FS:500,6000>"));
    }

    [Fact]
    public void MeasuredSpeed_AfterM5_DrainsToZero_AndIgnoresCoastReadings()
    {
        Report("<Run|MPos:0,0,0|FS:0,6000>");
        _t.CorrectReport("[MSG:INFO: Current speed is 6000]");

        var first = Report("<Idle|MPos:0,0,0|FS:0,0>");
        var rpm = double.Parse(first.Split("FS:0,0,")[1].Split('|')[0]);
        Assert.InRange(rpm, 1, 5999);

        // A coast-down reading after M5 doesn't bump the gauge back up.
        _t.CorrectReport("[MSG:INFO: Current speed is 5000]");
        string last = "";
        for (var i = 0; i < 30; i++) last = Report("<Idle|MPos:0,0,0|FS:0,0>");
        Assert.Contains("|FS:0,0,0|", last);
    }

    [Theory]
    [InlineData("[MSG:INFO: Syncing to 6000]")]
    [InlineData("[MSG:INFO: Synced speed to 6000]")]
    public void SpindleSyncChatter_IsDropped(string line) => Assert.Null(_t.CorrectReport(line));

    [Fact]
    public void FluidNcInfo_StaysAsItIs() =>
        Assert.Equal("[MSG:INFO: Connected - IP is 10.0.2.26]", Report("[MSG:INFO: Connected - IP is 10.0.2.26]"));

    // Plugin sentinels and NCSENDER_PAUSE dialogs read grblHAL's echo.
    [Theory]
    [InlineData("[MSG:INFO: MSG, TOOL_CHANGE_START 3]", "[MSG:TOOL_CHANGE_START 3]")]
    [InlineData("[MSG:INFO: MSG, NCSENDER_PAUSE: Dust shoe | Fit it]", "[MSG:NCSENDER_PAUSE: Dust shoe | Fit it]")]
    [InlineData("[MSG:INFO: MSG,PLUGIN_ATC:done]", "[MSG:PLUGIN_ATC:done]")]
    public void EchoedMsgComment_ReadsLikeGrblHal(string line, string expected) =>
        Assert.Equal(expected, Report(line));

    [Fact]
    public void AlarmList_ReadsLikeGrblHal_OnlyWhileAsked()
    {
        Assert.Equal("2: Soft Limit", Report("2: Soft Limit"));
        _t.Translate("$EA");
        Assert.Equal("[ALARMCODE:1||Hard Limit]", Report("1: Hard Limit"));
        Assert.Equal("[ALARMCODE:18||Probe Hard Limit]", Report("18: Probe Hard Limit"));
        _t.ObserveData("ok");
        Assert.Equal("2: Soft Limit", Report("2: Soft Limit"));
    }

    // FluidNC keeps reporting the last run's line number after a reset; a new
    // Start then read as if it began mid-file (#82).
    [Fact]
    public void LineNumber_FromBeforeAReset_IsHidden_UntilANewOneRuns()
    {
        Report("<Run|MPos:0,0,0|Ln:7|FS:600,0>");
        _t.Reset();
        Assert.DoesNotContain("Ln:", Report("<Idle|MPos:0,0,0|Ln:7|FS:0,0>"));
        Assert.Contains("|Ln:3|", Report("<Run|MPos:0,0,0|Ln:3|FS:600,0>"));
        Assert.Contains("|Ln:7|", Report("<Run|MPos:0,0,0|Ln:7|FS:600,0>"));
    }

    [Fact]
    public void Status_AlreadyWithHomedField_IsNotGivenAnother() =>
        Assert.Single(Report("<Idle|MPos:0,0,0|FS:0,0|H:0>").Split('|'), f => f.StartsWith("H:"));
}
