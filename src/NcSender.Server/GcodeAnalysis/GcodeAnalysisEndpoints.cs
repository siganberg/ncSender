using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.GcodeAnalysis;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class GcodeAnalysisEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/api/gcode-job/analyze-line", async (AnalyzeLineRequest request, IGcodeAnalyzer analyzer, IServerContext context, ICncController cnc, ISettingsManager settings) =>
        {
            var job = context.State.JobLoaded;
            if (job is null)
                return Results.BadRequest(new ApiError("No G-code file loaded"));

            var cachePath = Path.Combine(PathUtils.GetGcodeCacheDir(), "current.gcode");
            if (!File.Exists(cachePath))
                return Results.BadRequest(new ApiError("No cached G-code file found"));

            var content = await File.ReadAllTextAsync(cachePath);
            var lines = content.Split('\n');
            var totalLines = lines.Length;
            var lineNumber = request.LineNumber;

            if (lineNumber > totalLines)
                return Results.BadRequest(new ApiError($"Line {lineNumber} exceeds file length ({totalLines} lines)"));

            // Check if selected line is in the middle of an arc and adjust if needed
            var arcStart = analyzer.FindArcStart(lines, lineNumber);
            var effectiveLine = arcStart ?? lineNumber;
            var wasAdjusted = arcStart.HasValue;

            var warnings = new List<string>();
            if (wasAdjusted)
                warnings.Add($"Line <strong>{lineNumber}</strong> is in the middle of an arc. Adjusted to line <strong>{effectiveLine}</strong> instead (arc start).");

            // Analyze to effectiveLine - 1 to get state BEFORE the start line
            var targetLine = Math.Max(1, effectiveLine - 1);
            var state = analyzer.AnalyzeToLine(content, targetLine);

            // If the start line itself is a tool change, use the NEW tool in the preamble
            if (effectiveLine <= lines.Length)
            {
                var startLineWords = GcodeStateAnalyzer.ParseWords(StripLineComments(lines[effectiveLine - 1]));
                var hasToolChange = startLineWords.Any(w => w.Letter == 'M' && (int)w.Value == 6);
                if (hasToolChange)
                {
                    var toolWord = startLineWords.Find(w => w.Letter == 'T');
                    if (toolWord is not null)
                        state.Tool = (int)toolWord.Value;
                }
            }

            // Check if the target line is a rapid (G0) move — if so, skip plunging into material
            var targetLineIsRapid = IsTargetLineRapid(lines, effectiveLine, state);

            var resumeOptions = new StartFromLineRequest { StartLine = effectiveLine, SafeZHeight = settings.GetSetting<double>("safeZHeight", -5), TargetLineIsRapid = targetLineIsRapid };
            var resumeSequence = analyzer.GenerateResumeSequence(state, resumeOptions);

            var currentTool = cnc.LastStatus.Tool;
            var toolMismatch = state.Tool != currentTool && state.Tool > 0;

            return Results.Ok(new AnalyzeLineResponse
            {
                State = state,
                ResumeSequence = resumeSequence,
                ToolMismatch = toolMismatch,
                CurrentTool = currentTool,
                TargetTool = state.Tool,
                LineNumber = effectiveLine,
                OriginalLineNumber = wasAdjusted ? lineNumber : null,
                LineAdjusted = wasAdjusted,
                TotalLines = totalLines,
                Warnings = warnings
            });
        });

        app.MapPost("/api/gcode-job/start-from-line", async (StartFromLineRequest request, IGcodeAnalyzer analyzer, IJobManager jobManager, ICncController cnc, IServerContext context, ISettingsManager settings) =>
        {
            if (!cnc.IsConnected)
                return Results.BadRequest(new StartFromLineResponse { Success = false, Error = "Controller not connected" });

            if (cnc.LastStatus.Status != "Idle")
                return Results.BadRequest(new StartFromLineResponse { Success = false, Error = "Controller not idle" });

            var job = context.State.JobLoaded;
            if (job is null)
                return Results.BadRequest(new StartFromLineResponse { Success = false, Error = "No G-code file loaded" });

            try
            {
                var cachePath = Path.Combine(PathUtils.GetGcodeCacheDir(), "current.gcode");
                var content = await File.ReadAllTextAsync(cachePath);
                var lines = content.Split('\n');
                var startLine = request.StartLine;

                // Check if selected line is in the middle of an arc and adjust if needed
                var arcStart = analyzer.FindArcStart(lines, startLine);
                var effectiveLine = arcStart ?? startLine;
                var wasAdjusted = arcStart.HasValue;

                request.SafeZHeight = settings.GetSetting<double>("safeZHeight", -5);

                // Analyze to effectiveLine - 1 to get state BEFORE the start line
                var targetLine = Math.Max(1, effectiveLine - 1);
                var state = analyzer.AnalyzeToLine(content, targetLine);

                // If the start line itself is a tool change, use the NEW tool
                if (effectiveLine <= lines.Length)
                {
                    var startLineWords = GcodeStateAnalyzer.ParseWords(StripLineComments(lines[effectiveLine - 1]));
                    var hasToolChange = startLineWords.Any(w => w.Letter == 'M' && (int)w.Value == 6);
                    if (hasToolChange)
                    {
                        var toolWord = startLineWords.Find(w => w.Letter == 'T');
                        if (toolWord is not null)
                            state.Tool = (int)toolWord.Value;
                    }
                }

                // Check if the target line is a rapid (G0) move — if so, skip plunging into material
                request.TargetLineIsRapid = IsTargetLineRapid(lines, effectiveLine, state);

                var resumeSequence = analyzer.GenerateResumeSequence(state, request);

                await jobManager.StartJobFromLineAsync(effectiveLine, resumeSequence.ToArray());

                return Results.Ok(new StartFromLineResponse
                {
                    Success = true,
                    Message = wasAdjusted
                        ? $"G-code job started from line {effectiveLine} (adjusted from {startLine} - arc start)"
                        : $"G-code job started from line {effectiveLine}",
                    ResumeSequence = resumeSequence,
                    StartLine = effectiveLine,
                    OriginalStartLine = wasAdjusted ? startLine : null,
                    LineAdjusted = wasAdjusted
                });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new StartFromLineResponse { Success = false, Error = ex.Message });
            }
        });
    }

    private static bool IsTargetLineRapid(string[] lines, int effectiveLine, GcodeState state)
    {
        if (effectiveLine < 1 || effectiveLine > lines.Length) return false;

        var words = GcodeStateAnalyzer.ParseWords(StripLineComments(lines[effectiveLine - 1]));
        var gWord = words.Find(w => w.Letter == 'G' && w.Value is 0 or 1 or 2 or 3);

        // If the target line explicitly has G0, it's a rapid
        if (gWord is not null)
            return (int)gWord.Value == 0;

        // No explicit motion mode on this line — use the modal state from previous lines
        return state.MotionMode == "G0";
    }

    private static string StripLineComments(string line)
    {
        var result = line.Trim();
        while (true)
        {
            var start = result.IndexOf('(');
            if (start < 0) break;
            var end = result.IndexOf(')', start);
            if (end < 0) break;
            result = result[..start] + result[(end + 1)..];
        }
        var semiIdx = result.IndexOf(';');
        if (semiIdx >= 0) result = result[..semiIdx];
        return result.Trim();
    }
}
