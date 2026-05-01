using System.Text.RegularExpressions;
using NcSender.Server.Probing.Strategies;

namespace NcSender.Server.Tests;

public class ThreeDProbeStrategyTests
{
    // FluidNC follows the LinuxCNC G-code spec, which rejects a leading minus
    // on a bracketed expression after an axis letter (e.g. "X-[expr]"). The
    // expression must be either a number — which may itself be negative — or a
    // bracketed group, but not a mixture. grblHAL accepts the bad form, which
    // is why issue #55 only surfaced on FluidNC.
    private static readonly Regex BadFluidNcPattern = new(@"\b[XYZ]-\[", RegexOptions.Compiled);

    public static IEnumerable<object[]> CenterRoutines()
    {
        yield return new object[] { "Inner", ThreeDProbeStrategy.GetCenterInnerRoutine(30, 30) };
        yield return new object[] { "Outer", ThreeDProbeStrategy.GetCenterOuterRoutine(30, 30) };
    }

    [Theory]
    [MemberData(nameof(CenterRoutines))]
    public void CenterRoutine_DoesNotEmitFluidNcIncompatibleSyntax(string label, List<string> routine)
    {
        var offenders = routine
            .Where(line => BadFluidNcPattern.IsMatch(line))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{label} routine emits {offenders.Count} FluidNC-incompatible line(s) " +
            $"(leading minus on a bracketed expression after axis letter):\n" +
            string.Join("\n", offenders));
    }

    [Theory]
    [MemberData(nameof(CenterRoutines))]
    public void CenterRoutine_CapturesBothProbePointsPerAxis(string label, List<string> routine)
    {
        // The routine must capture two probe points per axis into named
        // parameters #<X1>/#<X2>/#<Y1>/#<Y2>. Don't change the variable
        // contract without coordinating with the midpoint move expression.
        Assert.Contains(routine, line => line.Contains("#<X1> = #5061"));
        Assert.Contains(routine, line => line.Contains("#<X2> = #5061"));
        Assert.Contains(routine, line => line.Contains("#<Y1> = #5062"));
        Assert.Contains(routine, line => line.Contains("#<Y2> = #5062"));
    }

    [Theory]
    [MemberData(nameof(CenterRoutines))]
    public void CenterRoutine_MidpointMoveEvaluatesToHalfDistance(string label, List<string> routine)
    {
        // After the X probes finish at X2, a relative move must take the
        // tool to the midpoint between X1 and X2. The signed offset is
        // (X1 - X2) / 2 — substitute concrete values and evaluate to verify
        // the math, regardless of how the expression is written textually.
        AssertMidpointMove(routine, axis: 'X', x1: 0, x2: 10, expected: -5, label: label);
        AssertMidpointMove(routine, axis: 'Y', x1: 0, x2: 10, expected: -5, label: label);

        // Sanity check: an asymmetric capture still produces the right offset.
        AssertMidpointMove(routine, axis: 'X', x1: 4, x2: 14, expected: -5, label: label);
    }

    private static void AssertMidpointMove(List<string> routine, char axis, double x1, double x2, double expected, string label)
    {
        // Find the midpoint move: a G0 line referencing both #<{axis}1> and #<{axis}2>.
        var line = routine.FirstOrDefault(l =>
            l.Contains($"#<{axis}1>", StringComparison.OrdinalIgnoreCase) &&
            l.Contains($"#<{axis}2>", StringComparison.OrdinalIgnoreCase) &&
            l.TrimStart().StartsWith("G0 ", StringComparison.OrdinalIgnoreCase));

        Assert.NotNull(line);

        // Extract the expression after the axis letter.
        var idx = line!.IndexOf(axis, StringComparison.OrdinalIgnoreCase);
        Assert.True(idx >= 0, $"{label}: no {axis} argument in midpoint line: {line}");
        var argument = line[(idx + 1)..];

        // Substitute parameters and convert LinuxCNC bracket syntax to standard
        // arithmetic, then evaluate.
        var expr = argument
            .Replace($"#<{axis}1>", x1.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .Replace($"#<{axis}2>", x2.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .Replace('[', '(')
            .Replace(']', ')');

        var actual = EvaluateArithmetic(expr);
        Assert.Equal(expected, actual, precision: 6);
    }

    // Minimal arithmetic evaluator for "(", ")", unary "-", "+", "-", "*", "/".
    // Sufficient for the midpoint expressions; intentionally not a general
    // G-code expression engine.
    private static double EvaluateArithmetic(string expr)
    {
        var pos = 0;
        var result = ParseExpression(expr.Replace(" ", ""), ref pos);
        if (pos != expr.Replace(" ", "").Length)
            throw new InvalidOperationException($"Unparsed tail at {pos}: '{expr}'");
        return result;
    }

    private static double ParseExpression(string s, ref int pos)
    {
        var value = ParseTerm(s, ref pos);
        while (pos < s.Length && (s[pos] == '+' || s[pos] == '-'))
        {
            var op = s[pos++];
            var rhs = ParseTerm(s, ref pos);
            value = op == '+' ? value + rhs : value - rhs;
        }
        return value;
    }

    private static double ParseTerm(string s, ref int pos)
    {
        var value = ParseFactor(s, ref pos);
        while (pos < s.Length && (s[pos] == '*' || s[pos] == '/'))
        {
            var op = s[pos++];
            var rhs = ParseFactor(s, ref pos);
            value = op == '*' ? value * rhs : value / rhs;
        }
        return value;
    }

    private static double ParseFactor(string s, ref int pos)
    {
        if (pos < s.Length && s[pos] == '+') { pos++; return ParseFactor(s, ref pos); }
        if (pos < s.Length && s[pos] == '-') { pos++; return -ParseFactor(s, ref pos); }
        if (pos < s.Length && s[pos] == '(')
        {
            pos++;
            var v = ParseExpression(s, ref pos);
            if (pos >= s.Length || s[pos] != ')')
                throw new InvalidOperationException($"Expected ')' at {pos} in '{s}'");
            pos++;
            return v;
        }
        var start = pos;
        while (pos < s.Length && (char.IsDigit(s[pos]) || s[pos] == '.'))
            pos++;
        if (start == pos) throw new InvalidOperationException($"Expected number at {pos} in '{s}'");
        return double.Parse(s[start..pos], System.Globalization.CultureInfo.InvariantCulture);
    }
}
