using System.Globalization;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.GcodeAnalysis;

public class GcodeStateAnalyzer : IGcodeAnalyzer
{
    public GcodeState AnalyzeToLine(string content, int targetLine)
    {
        var state = new GcodeState();
        var lines = content.Split('\n');
        var lineCount = 0;

        foreach (var rawLine in lines)
        {
            lineCount++;
            if (lineCount > targetLine) break;

            var line = StripComments(rawLine.Trim());
            if (string.IsNullOrWhiteSpace(line)) continue;

            var words = ParseWords(line);
            ProcessWords(words, state);
        }

        return state;
    }

    public List<string> GenerateResumeSequence(GcodeState state, StartFromLineRequest options)
    {
        return ResumeSequenceGenerator.Generate(state, options);
    }

    public int? FindArcStart(string[] lines, int selectedLine)
    {
        if (selectedLine < 1 || selectedLine > lines.Length) return null;

        var line = lines[selectedLine - 1].Trim();
        var words = ParseWords(line);

        // Check if line has arc parameters but no G2/G3
        var hasArcParams = words.Any(w => w.Letter is 'I' or 'J' or 'K' or 'R');
        var hasArcCommand = words.Any(w => w.Letter == 'G' && w.Value is 2 or 3);

        if (!hasArcParams || hasArcCommand) return null;

        // Search backward for G2/G3
        for (var i = selectedLine - 2; i >= 0; i--)
        {
            var prevWords = ParseWords(StripComments(lines[i].Trim()));
            if (prevWords.Any(w => w.Letter == 'G' && w.Value is 2 or 3))
                return i + 1;
            // If we hit another G-code motion mode, stop searching
            if (prevWords.Any(w => w.Letter == 'G' && w.Value is 0 or 1))
                return null;
        }

        return null;
    }

    internal static List<GcodeWord> ParseWords(string line)
    {
        var words = new List<GcodeWord>();
        // Strip N-number prefix
        if (line.Length > 1 && (line[0] == 'N' || line[0] == 'n') && char.IsDigit(line[1]))
        {
            var spaceIdx = line.IndexOf(' ');
            if (spaceIdx > 0)
                line = line[(spaceIdx + 1)..];
        }

        var i = 0;
        while (i < line.Length)
        {
            if (char.IsWhiteSpace(line[i])) { i++; continue; }

            var letter = char.ToUpper(line[i]);
            if (!char.IsLetter(letter)) { i++; continue; }

            i++;
            var start = i;
            while (i < line.Length && (char.IsDigit(line[i]) || line[i] == '.' || line[i] == '-' || line[i] == '+'))
                i++;

            if (start < i && double.TryParse(line[start..i], NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            {
                words.Add(new GcodeWord { Letter = letter, Value = value });
            }
        }

        return words;
    }

    private static void ProcessWords(List<GcodeWord> words, GcodeState state)
    {
        foreach (var word in words)
        {
            switch (word.Letter)
            {
                case 'G':
                    ProcessGCode(word.Value, state);
                    break;
                case 'M':
                    ProcessMCode(word.Value, words, state);
                    break;
                case 'F':
                    state.FeedRate = word.Value;
                    break;
                case 'S':
                    state.SpindleSpeed = word.Value;
                    break;
                case 'T':
                    state.Tool = (int)word.Value;
                    break;
                case 'X':
                    if (state.PositioningMode == "G90")
                        state.PositionX = word.Value;
                    else
                        state.PositionX += word.Value;
                    break;
                case 'Y':
                    if (state.PositioningMode == "G90")
                        state.PositionY = word.Value;
                    else
                        state.PositionY += word.Value;
                    break;
                case 'Z':
                    if (state.PositioningMode == "G90")
                        state.PositionZ = word.Value;
                    else
                        state.PositionZ += word.Value;
                    break;
            }
        }
    }

    private static void ProcessGCode(double value, GcodeState state)
    {
        var code = (int)value;
        switch (code)
        {
            case 0: case 1: case 2: case 3:
                state.MotionMode = $"G{code}";
                break;
            case 17: case 18: case 19:
                state.Plane = $"G{code}";
                break;
            case 20: case 21:
                state.Units = $"G{code}";
                break;
            case 54: case 55: case 56: case 57: case 58: case 59:
                state.Wcs = $"G{code}";
                break;
            case 90: case 91:
                state.PositioningMode = $"G{code}";
                break;
        }
    }

    private static void ProcessMCode(double value, List<GcodeWord> words, GcodeState state)
    {
        var code = (int)value;
        switch (code)
        {
            case 3:
                state.SpindleState = "M3";
                break;
            case 4:
                state.SpindleState = "M4";
                break;
            case 5:
                state.SpindleState = "M5";
                break;
            case 6:
                var toolWord = words.Find(w => w.Letter == 'T');
                if (toolWord is not null)
                    state.Tool = (int)toolWord.Value;
                break;
            case 7:
                state.CoolantMist = true;
                break;
            case 8:
                state.CoolantFlood = true;
                break;
            case 9:
                state.CoolantFlood = false;
                state.CoolantMist = false;
                break;
            case 64:
                // Aux output on
                var pWord64 = words.Find(w => w.Letter == 'P');
                if (pWord64 is not null)
                    state.AuxOutputs[(int)pWord64.Value] = true;
                break;
            case 65:
                // Aux output off
                var pWord65 = words.Find(w => w.Letter == 'P');
                if (pWord65 is not null)
                    state.AuxOutputs[(int)pWord65.Value] = false;
                break;
        }
    }

    private static string StripComments(string line)
    {
        // Remove parenthesized comments
        var result = line;
        while (true)
        {
            var start = result.IndexOf('(');
            if (start < 0) break;
            var end = result.IndexOf(')', start);
            if (end < 0) break;
            result = result[..start] + result[(end + 1)..];
        }
        // Remove semicolon comments
        var semiIdx = result.IndexOf(';');
        if (semiIdx >= 0) result = result[..semiIdx];
        return result.Trim();
    }

    internal class GcodeWord
    {
        public char Letter { get; set; }
        public double Value { get; set; }
    }
}
