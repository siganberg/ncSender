using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IGcodeAnalyzer
{
    GcodeState AnalyzeToLine(string content, int targetLine);
    List<string> GenerateResumeSequence(GcodeState state, StartFromLineRequest options);
    int? FindArcStart(string[] lines, int selectedLine);
}
