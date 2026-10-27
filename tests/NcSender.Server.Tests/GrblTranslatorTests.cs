using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Protocols.Grbl;

namespace NcSender.Server.Tests;

// Classic Grbl runs what grblHAL would after the translator has worked out the
// expressions, parameters and o-word flow. Each case is a line grblHAL
// accepts, and the plain line Grbl must get for the same motion.
public class GrblTranslatorTests
{
    private readonly MachineState _state = new() { G54 = "0.000,0.000,-50.000", G55 = "10.000,20.000,-30.000" };
    private readonly GrblTranslator _t;

    public GrblTranslatorTests() => _t = new GrblTranslator(() => _state);

    private string[] Writes(TranslationResult r)
    {
        Assert.Equal(TranslationKind.Run, r.Kind);
        return r.Steps.Where(s => s.Write is not null).Select(s => s.Write!).ToArray();
    }

    // Runs a line, answering any Sync request the way the controller would
    // (the offsets are already in _state).
    private TranslationResult Run(string line)
    {
        var r = _t.Translate(line);
        for (var i = 0; r.Kind == TranslationKind.Sync && i < 3; i++) r = _t.Translate(line);
        return r;
    }

    private string Single(string line) => Assert.Single(Writes(Run(line)));

    [Theory]
    [InlineData("G0 X1 Y2", "G0 X1 Y2")]
    [InlineData("g1 x-1.5 f300", "G1 X-1.5 F300")]
    [InlineData("N12 G1 X.5", "N12 G1 X.5")]
    [InlineData("G0 X1 (careful! ~ ?)", "G0 X1")]
    [InlineData("G0 X1 ; rest of line", "G0 X1")]
    public void PlainLines_GoOutAsWritten(string line, string expected) => Assert.Equal(expected, Single(line));

    [Theory]
    [InlineData("G0 X[1+2*3]", "G0 X7")]
    [InlineData("G0 X[[1+2]*3]", "G0 X9")]
    [InlineData("G0 X[2**3 - 10 MOD 4]", "G0 X6")]
    [InlineData("G0 X[ABS[-2.5]] Y[SQRT[16]] Z[ROUND[1.5]]", "G0 X2.5 Y4 Z2")]
    [InlineData("G0 X[ATAN[1]/[1]] Y[FIX[-1.5]] Z[FUP[1.2]]", "G0 X45 Y-2 Z2")]
    [InlineData("G0 X[1 EQ 1] Y[2 LT 1] Z[1 AND 0 OR 1]", "G0 X1 Y0 Z1")]
    [InlineData("G0 X-[2]", "G0 X-2")]
    [InlineData("G0 X[1/3]", "G0 X0.3333")]
    public void Expressions_AreEvaluated(string line, string expected) => Assert.Equal(expected, Single(line));

    [Fact]
    public void UnitsSaveAndRestore_TheProbingPattern()
    {
        Assert.Empty(Writes(Run("#<return_units> = [20 + #<_metric>]")));
        Assert.Equal("G20 G91", Single("G20 G91"));
        Assert.Equal("G21", Single("G[#<return_units>]"));
    }

    [Fact]
    public void Assignment_TakesEffectAfterTheLine()
    {
        Run("#1 = 5");
        Assert.Equal("G0 X5", Single("#1 = 9 G0 X#1"));
        Assert.Equal("G0 X9", Single("G0 X#1"));
    }

    [Fact]
    public void ProbeResult_InWorkCoordinates_AfterReadingOffsets()
    {
        _t.ObserveData("[PRB:10.000,20.000,-45.000:1]");
        // Grbl answers $# only when Idle: let motion finish first.
        var first = _t.Translate("#<z> = #5063");
        Assert.Equal(TranslationKind.Sync, first.Kind);
        Assert.Equal("G4 P0", first.SyncCommand);
        Assert.Equal("$#", _t.Translate("#<z> = #5063").SyncCommand);
        Assert.Empty(Writes(_t.Translate("#<z> = #5063")));
        Assert.Equal("G0 Z5", Single("G0 Z[#<z>]"));
        Assert.Equal("G0 X1", Single("G0 X#5070"));
    }

    [Fact]
    public void ManualToolChange_CurrentOffsetThroughIndirection()
    {
        Run("#<_ofs_idx> = [#5220 * 20 + 5203]");
        Run("#<_cur_wcs_z_ofs> = #[#<_ofs_idx>]");
        Assert.Equal("G10 L2 P1 Z-51.5", Single("G10 L2 P[#5220] Z[#<_cur_wcs_z_ofs> - 1.5]"));

        // In G55 the same lines read G55's offset.
        Single("G55");
        Run("#<_ofs_idx> = [#5220 * 20 + 5203]");
        Run("#<_cur_wcs_z_ofs> = #[#<_ofs_idx>]");
        Assert.Equal("G10 L2 P2 Z-30", Single("G10 L2 P[#5220] Z[#<_cur_wcs_z_ofs>]"));
    }

    [Fact]
    public void OffsetsAreReadAgain_AfterALineChangesThem()
    {
        Run("#1 = #5223");
        Single("G10 L20 P1 Z0");
        Assert.Equal(TranslationKind.Sync, _t.Translate("#1 = #5223").Kind);
    }

    [Fact]
    public void Inches_ScaleProbeAndOffsetValues()
    {
        Single("G20");
        Run("#1 = #5223");
        Assert.Equal("G0 Z-1.9685", Single("G0 Z[#1]"));
    }

    [Theory]
    [InlineData(true, "G0 Z5")]
    [InlineData(false, null)]
    public void OWordIf_RunsOnlyTheBranchTaken(bool touched, string? expected)
    {
        _t.ObserveData($"[PRB:0,0,0:{(touched ? 1 : 0)}]");
        Run("#<probe_hit> = #5070");
        Assert.Empty(Writes(Run("O100 IF [#<probe_hit> EQ 1]")));
        var inside = Writes(Run("G0 Z5"));
        Assert.Empty(Writes(Run("O100 ENDIF")));
        if (expected is null) Assert.Empty(inside);
        else Assert.Equal(expected, Assert.Single(inside));
        Assert.Equal("G0 Z1", Single("G0 Z1"));
    }

    [Fact]
    public void OWord_ElseIfElse_AndNesting()
    {
        Run("#1 = 2");
        var sent = new List<string>();
        foreach (var line in new[]
        {
            "o1 if [#1 EQ 1]", "G0 X1",
            "o1 elseif [#1 EQ 2]", "G0 X2",
                "o2 if [1]", "G0 Y2", "o2 else", "G0 Y3", "o2 endif",
            "o1 else", "G0 X3",
                "o3 if [1]", "G0 Y9", "o3 endif",
            "o1 endif",
            "G0 Z0",
        })
            sent.AddRange(Writes(Run(line)));
        Assert.Equal(["G0 X2", "G0 Y2", "G0 Z0"], sent);
    }

    [Fact]
    public void SkippedBranch_DoesNotEvaluateItsLines()
    {
        Run("o9 if [0]");
        Assert.Empty(Writes(Run("G0 X[#<never_set>]")));
        Assert.Empty(Writes(Run("M64 P1")));
        Run("o9 endif");
    }

    [Fact]
    public void UnmatchedEndif_Fails() => Assert.Equal(TranslationKind.Fail, _t.Translate("o5 endif").Kind);

    [Fact]
    public void Loops_FailForNow() => Assert.Equal(TranslationKind.Fail, _t.Translate("o5 while [1]").Kind);

    [Fact]
    public void Msg_IsReportedAsGrblHalWouldEchoIt()
    {
        var r = Run("(MSG, TOOL_CHANGE_START 3)");
        Assert.Equal("[MSG:TOOL_CHANGE_START 3]", Assert.Single(r.Steps).Message);

        var pause = Run("(MSG, NCSENDER_PAUSE: Dust shoe | Fit it, then Continue)M0");
        Assert.Equal("[MSG:NCSENDER_PAUSE: Dust shoe | Fit it, then Continue]", pause.Steps[0].Message);
        Assert.Equal("M0", pause.Steps[1].Write);
    }

    [Fact]
    public void Comments_OnlyLinesSendNothing()
    {
        Assert.Empty(Run("(DONGLE:xio:out 1 1)").Steps);
        Assert.Empty(Run("%").Steps);
        Assert.Empty(Run("").Steps);
    }

    [Theory]
    [InlineData("M64 P1")]
    [InlineData("M65 P1")]
    [InlineData("M66 P0 L3 Q1")]
    [InlineData("M51 P0")]
    [InlineData("G43 H1")]
    [InlineData("G10 L1 P1 Z5")]
    [InlineData("G65 P9")]
    [InlineData("G59.1")]
    [InlineData("G0 X#5420")]
    [InlineData("G0 X[#<not_set>]")]
    [InlineData("#<_metric> = 1")]
    [InlineData("G0 X[1/0]")]
    [InlineData("G0 X[1")]
    public void UnsupportedOrInvalid_FailsWithAReason(string line)
    {
        var r = Run(line);
        Assert.Equal(TranslationKind.Fail, r.Kind);
        Assert.False(string.IsNullOrWhiteSpace(r.Error));
    }

    [Fact]
    public void M6_BecomesAPauseToLoadTheTool()
    {
        var r = Run("M6 T3");
        Assert.Equal("T3", r.Steps[0].Write);
        Assert.Contains("NCSENDER_PAUSE", r.Steps[1].Message);
        Assert.Contains("T3", r.Steps[1].Message);
        Assert.Equal("M0", r.Steps[2].Write);
    }

    [Fact]
    public void M6_WithoutT_UsesTheToolSelectedBefore()
    {
        Single("T7");
        var r = Run("M6");
        Assert.Contains("T7", r.Steps[0].Message);
        Assert.Equal("M0", r.Steps[1].Write);
    }

    [Fact]
    public void M61_SetsTheToolWithATWord() => Assert.Equal("T4", Writes(Run("M61 Q4")).Last());

    [Fact]
    public void ProbeSelect_IsDropped() => Assert.Empty(Run("G65 P5 Q1").Steps);

    // Tool changer plugins skip grblHAL's spindle-at-speed wait with G65 P6;
    // Grbl never waits, so it goes.
    [Fact]
    public void SpindleWaitSkip_IsDropped()
    {
        Assert.Empty(Run("G65P6").Steps);
        Assert.Empty(Run("G65 P6").Steps);
    }

    [Fact]
    public void SystemCommands_PassThrough_ExceptParameterQueries()
    {
        Assert.Equal("$H", Single("$H"));
        Assert.Equal("$J=G91 X1 F100", Single("$J=G91 X1 F100"));
        Assert.Empty(Run("$#=_other").Steps);
    }

    [Fact]
    public void ToolOffsetQuery_IsAnsweredFromTheLastG431()
    {
        Assert.Equal("[PARAM:_TOOL_OFFSET=0]", Assert.Single(Run("$#=_tool_offset").Steps).Message);
        Single("G43.1 Z-63.2");
        Assert.Equal("[PARAM:_TOOL_OFFSET=1]", Assert.Single(Run("$#=_tool_offset").Steps).Message);
        Single("G49");
        Assert.Equal("[PARAM:_TOOL_OFFSET=0]", Assert.Single(Run("$#=_tool_offset").Steps).Message);
    }

    [Fact]
    public void LongLine_LosesSpacesThenItsLineNumber_ThenFails()
    {
        var line = "N123456 G1 X100.1234 Y200.1234 Z-10.1234 A11.1234 B22.1234 C33.1234 F1000.5 S12000";
        var sent = Single(line);
        Assert.True(sent.Length <= GrblTranslator.MaxLineLength);
        Assert.DoesNotContain(' ', sent);
        Assert.StartsWith("N123456", sent);

        var longer = "N123456 G1 X100.1234 Y200.1234 Z-10.1234 A11.1234 B22.1234 C33.1234 F1000.5 S12000 T1 M3 L2 Q5";
        Assert.DoesNotContain("N", Single(longer));

        Assert.Equal(TranslationKind.Fail, Run("G1 X100.123456 Y200.123456 Z-10.123456 A11.123456 B22.123456 C33.123456 F1000.5 S12000 T1 M3").Kind);
    }

    [Fact]
    public void FailedLine_ClosesOpenBlocks_AndRereadsParserState()
    {
        Run("o1 if [0]");
        _t.OnLineFailed();
        var r = _t.Translate("G0 X1");
        Assert.Equal(TranslationKind.Sync, r.Kind);
        Assert.Equal("$G", r.SyncCommand);
        Assert.Equal("G0 X1", Single("G0 X1"));
    }

    [Fact]
    public void ParserReport_SeedsModalState()
    {
        _t.ObserveData("[GC:G0 G55 G17 G20 G91 G94 M5 M9 T2 F100 S0]");
        Run("#1 = [#<_metric> * 10 + #<_absolute>]");
        Assert.Equal("G0 X0", Single("G0 X#1"));
        Assert.Equal("G0 X2", Single("G0 X#5220"));
        // Not the tool: Grbl's T is only the last line's T word.
        Assert.Equal("G0 X0", Single("G0 X#<_current_tool>"));
    }

    // The tool changes once the moves before M61 are done, not as it is read.
    [Fact]
    public void SetTool_WaitsForQueuedMoves()
    {
        Assert.Equal(["G4 P0", "T0"], Writes(Run("M61 Q0")));
    }

    [Fact]
    public void Tool_IsTheLastTWordSent()
    {
        Run("M61 Q3");
        Run("G0 X1");
        const string report = "[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]";
        _t.ObserveData(report);
        Assert.Equal("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T3 F0 S0]", _t.CorrectReport(report));
        Assert.Equal("G0 X3", Single("G0 X#<_current_tool>"));
    }

    // A reset clears Grbl's tool length offset, not the measured tool: it goes
    // back before the next line, so the work Z doesn't jump after a Stop.
    // The parser state is read first: the units are whatever Grbl came back in.
    [Fact]
    public void ToolLengthOffset_IsRestoredAfterAReset()
    {
        Run("G43.1 Z-36.141");
        _t.Reset();
        Assert.Equal("$G", _t.Translate("$G").SyncCommand);
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("G43.1 Z-36.141", _t.Translate("$G").SyncCommand);
        Assert.Equal(TranslationKind.Run, _t.Translate("$G").Kind);
        Assert.Equal("G0 X1", Single("G0 X1"));
    }

    // Nomad report: a startup line left Grbl in G20 after the reset, and the
    // offset went back as -25.25 inches (-641 mm).
    [Fact]
    public void ToolLengthOffset_IsRestoredInTheUnitsGrblIsIn()
    {
        Run("G43.1 Z-25.25");
        _t.Reset();
        Assert.Equal("$G", _t.Translate("$G").SyncCommand);
        _t.ObserveData("[GC:G0 G54 G17 G20 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("G43.1 Z-0.99409", _t.Translate("$G").SyncCommand);
    }

    // Nomad report, again: an "ok" left from the reset answered the $G before
    // its [GC:] arrived, and the offset went out in the wrong units.
    [Fact]
    public void ToolLengthOffset_WaitsForTheParserReportItself()
    {
        Run("G43.1 Z-32.822");
        _t.Reset();
        Assert.Equal("$G", _t.Translate("$G").SyncCommand);
        Assert.Equal(TranslationKind.Run, _t.Translate("$G").Kind);     // no report yet: not now
        _t.ObserveData("[GC:G0 G54 G17 G20 G90 G94 M5 M9 T0 F0 S0]");
        Assert.Equal("G43.1 Z-1.2922", _t.Translate("G0 X1").SyncCommand);
    }

    // No bounce after a Stop: until the restore lands, the reports carry the
    // offset Grbl dropped (WCO.Z short by it, WPos.Z long by it).
    [Fact]
    public void ToolLengthOffset_ReportsKeepItUntilItIsBack()
    {
        Run("G43.1 Z-25.25");
        _t.CorrectReport("<Idle|WPos:0.000,0.000,5.000|FS:0,0|WCO:0.000,0.000,-97.275>");
        _t.Reset();
        Assert.Equal("<Idle|WPos:0.000,0.000,5.000|FS:0,0|WCO:0.000,0.000,-97.275>",
            _t.CorrectReport("<Idle|WPos:0.000,0.000,-20.250|FS:0,0|WCO:0.000,0.000,-72.025>"));
        Assert.Equal("<Idle|WPos:0.000,0.000,5.000|FS:0,0>",
            _t.CorrectReport("<Idle|WPos:0.000,0.000,-20.250|FS:0,0>"));
        // The restore landed: Grbl's own report has it, and is passed on as is.
        Assert.Equal("<Idle|WPos:0.000,0.000,5.000|FS:0,0|WCO:0.000,0.000,-97.275>",
            _t.CorrectReport("<Idle|WPos:0.000,0.000,5.000|FS:0,0|WCO:0.000,0.000,-97.275>"));
        Assert.Equal("<Idle|WPos:0.000,0.000,5.000|FS:0,0>",
            _t.CorrectReport("<Idle|WPos:0.000,0.000,5.000|FS:0,0>"));
    }

    [Fact]
    public void ToolLengthOffset_ReportsStopMaskingWhenTheOffsetIsClearedMeanwhile()
    {
        Run("G43.1 Z-25.25");
        _t.CorrectReport("<Idle|WPos:0.000,0.000,5.000|FS:0,0|WCO:0.000,0.000,-97.275>");
        _t.Reset();
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]");
        Run("G49");
        Assert.Equal("<Idle|WPos:0.000,0.000,-20.250|FS:0,0>",
            _t.CorrectReport("<Idle|WPos:0.000,0.000,-20.250|FS:0,0>"));
    }

    [Fact]
    public void ToolLengthOffset_WaitsOutAnAlarmAndCoolant()
    {
        Run("G43.1 Z-10");
        _t.Reset();
        _state.Status = "Alarm";
        Assert.Equal(TranslationKind.Run, _t.Translate("$X").Kind);
        _state.Status = "Idle";
        Assert.Equal(TranslationKind.Run, _t.Translate("M8").Kind);
        Assert.Equal("$G", _t.Translate("G0 X1").SyncCommand);
        _t.ObserveData("[GC:G0 G54 G17 G21 G90 G94 M5 M8 T0 F0 S0]");
        Assert.Equal("G43.1 Z-10", _t.Translate("G0 X1").SyncCommand);
    }

    [Fact]
    public void ToolLengthOffset_ClearedWithG49_IsNotRestored()
    {
        Run("G43.1 Z-10");
        Run("G49");
        _t.Reset();
        Assert.Equal("G0 X1", Single("G0 X1"));
    }

    // $13=1: Grbl reports in inches; ncSender reads mm.
    [Fact]
    public void ReportInches_PositionsOffsetsAndFeedAreConvertedToMm()
    {
        _t.ObserveData("$13=1");
        Assert.Equal("<Idle|WPos:25.400,-50.800,12.700|Bf:14,128|FS:254.000,10000|WCO:-25.400,0.000,-6.350>",
            _t.CorrectReport("<Idle|WPos:1.0000,-2.0000,0.5000|Bf:14,128|FS:10.000,10000|WCO:-1.0000,0.0000,-0.2500>"));
        Assert.Equal("[G54:25.400,-50.800,-12.700]", _t.CorrectReport("[G54:1.0000,-2.0000,-0.5000]"));
        Assert.Equal("[PRB:25.400,0.000,-2.540:1]", _t.CorrectReport("[PRB:1.0000,0.0000,-0.1000:1]"));
        Assert.Equal("[TLO:-25.400]", _t.CorrectReport("[TLO:-1.0000]"));
        Assert.Equal("[MSG:Caution: Unlocked]", _t.CorrectReport("[MSG:Caution: Unlocked]"));
    }

    [Fact]
    public void ReportInches_Off_LeavesReportsAlone()
    {
        _t.ObserveData("$13=0");
        Assert.Equal("<Idle|MPos:1.000,2.000,3.000|FS:0,0>", _t.CorrectReport("<Idle|MPos:1.000,2.000,3.000|FS:0,0>"));
        Assert.Equal("[G54:1.000,2.000,3.000]", _t.CorrectReport("[G54:1.000,2.000,3.000]"));
    }

    // Setting it from the Firmware tab takes effect without a new $$.
    [Fact]
    public void ReportInches_FollowsTheSettingAsItIsWritten()
    {
        Assert.Empty(Writes(Run("$13=1")).Where(w => w != "$13=1"));
        Assert.Equal("[G54:25.400,0.000,0.000]", _t.CorrectReport("[G54:1.0000,0.0000,0.0000]"));
    }

    // Grbl forgets the tool on power-up; ncSender keeps it between runs.
    [Fact]
    public void Tool_IsKeptBetweenRuns()
    {
        var file = Path.Combine(Path.GetTempPath(), $"grbl-tool-{Guid.NewGuid():N}.txt");
        try
        {
            var first = new GrblTranslator(() => _state, file);
            first.Translate("M61 Q4");
            var next = new GrblTranslator(() => new MachineState(), file);
            Assert.Equal("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T4 F0 S0]",
                next.CorrectReport("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]"));
        }
        finally { File.Delete(file); }
    }

    // A reset clears Grbl's tool, not the one in the spindle.
    [Fact]
    public void Tool_SurvivesAReset()
    {
        Run("T2");
        _t.Reset();
        Assert.Equal("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T2 F0 S0]",
            _t.CorrectReport("[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]"));
        Assert.Equal("<Idle|MPos:0,0,0|FS:0,0>", _t.CorrectReport("<Idle|MPos:0,0,0|FS:0,0>"));
    }

    [Fact]
    public void ProbePin_IsReadFromAStatusReportNewerThanTheLastReply()
    {
        _state.Pn = "P";
        Assert.Equal("?", _t.Translate("#1 = #<_probe_state>").SyncCommand);
        _t.ObserveData("<Idle|MPos:0,0,0|FS:0,0|Pn:P>");
        Assert.Empty(Writes(_t.Translate("#1 = #<_probe_state>")));
        Assert.Equal("G0 X1", Single("G0 X#1"));

        _t.ObserveData("ok");
        Assert.Equal(TranslationKind.Sync, _t.Translate("#1 = #<_probe_state>").Kind);
    }

    [Fact]
    public void Reset_PutsTheParserBackToGrblDefaults()
    {
        Single("G20 G91 G56 T5");
        _t.Reset();
        Run("#1 = [#<_metric> + #<_absolute> + #5220 + #5400]");
        // G21 G90 G54, and the tool is kept: 1 + 1 + 1 + 5.
        Assert.Equal("G0 X8", Single("G0 X#1"));
    }

    // A job numbers every line, so the program delimiter comes as "N1 %".
    [Theory]
    [InlineData("%")]
    [InlineData("N1 %")]
    [InlineData("N7169 %")]
    public void ProgramDelimiter_IsDropped(string line) => Assert.Empty(Writes(Run(line)));

    // Shapeoko: homed at -1.5 with 1237 mm of travel, holding jog asked for
    // the whole travel and Grbl answered error:15.
    private void Homed(string mpos)
    {
        _state.Homed = true;
        _state.MPos = mpos;
        _state.MaxTravelX = 1237;
        _state.MaxTravelY = 1237;
        _state.MaxTravelZ = 100;
    }

    [Fact]
    public void Jog_IsShortenedToEndInsideTheTravel()
    {
        Homed("-2.500,-2.500,-1.500");
        Assert.Equal("$J=G21 G91 X-1234.49 Y-1234.49 F3000", Single("$J=G21 G91 X-1237 Y-1237 F3000"));
    }

    [Fact]
    public void Jog_TowardTheHomeEnd_StopsShortOfZero()
    {
        Homed("-2.500,-2.500,-1.500");
        Assert.Equal("$J=G21 G91 Z1.49 F1500", Single("$J=G21 G91 Z100 F1500"));
    }

    [Fact]
    public void Jog_InsideTheTravel_IsUnchanged()
    {
        Homed("-500.000,-500.000,-10.000");
        Assert.Equal("$J=G21 G91 X-1 Y-1 F3000", Single("$J=G21 G91 X-1 Y-1 F3000"));
    }

    [Fact]
    public void Jog_InInches_IsShortenedInInches()
    {
        Homed("-2.500,-2.500,-1.500");
        Assert.Equal("$J=G20 G91 Z0.059 F60", Single("$J=G20 G91 Z4 F60"));
    }

    [Fact]
    public void Jog_AtTheLimit_SendsNothing()
    {
        Homed("-1236.995,-500.000,-10.000");
        Assert.Empty(Writes(Run("$J=G21 G91 X-50 F3000")));
    }

    [Fact]
    public void Jog_BeforeHoming_IsUnchanged()
    {
        _state.MPos = "0.000,0.000,0.000";
        _state.MaxTravelX = 1237;
        Assert.Equal("$J=G21 G91 X-2000 F3000", Single("$J=G21 G91 X-2000 F3000"));
    }

    [Fact]
    public void AbsoluteJog_IsUnchanged()
    {
        Homed("-2.500,-2.500,-1.500");
        Assert.Equal("$J=G53 G90 X-10 F3000", Single("$J=G53 G90 X-10 F3000"));
    }
}
