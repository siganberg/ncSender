using System.Globalization;

namespace NcSender.Server.Protocols.Grbl;

/// <summary>A line that can't be evaluated; the message is shown to the operator.</summary>
public sealed class NgcException(string message) : Exception(message);

/// <summary>Where <see cref="NgcReader"/> gets parameter values from.</summary>
public interface INgcParameters
{
    double Get(int number);
    double GetNamed(string name);
    bool ExistsNamed(string name);
}

/// <summary>A parameter on the left of an assignment: #12, #&lt;name&gt; or #[expr].</summary>
public readonly record struct NgcParamRef(int? Number, string? Name);

/// <summary>
/// Reads the NGC dialect grblHAL and LinuxCNC share: [expressions], #numbered,
/// #&lt;named&gt; and #[indirect] parameters, and the unary/binary operators,
/// with LinuxCNC's precedence (** above * / MOD above + - above the
/// comparisons above AND OR XOR, left to right within a level).
/// </summary>
public sealed class NgcReader(string text, INgcParameters parameters)
{
    private const double EqualTolerance = 0.000001;
    private int _i;

    public int Position => _i;
    public bool AtEnd { get { SkipSpace(); return _i >= text.Length; } }
    public char Peek() { SkipSpace(); return _i < text.Length ? text[_i] : '\0'; }
    public string Rest => text[_i..];

    public char Next()
    {
        SkipSpace();
        if (_i >= text.Length) throw new NgcException("unexpected end of line");
        return text[_i++];
    }

    public void Expect(char c)
    {
        if (char.ToUpperInvariant(Next()) != char.ToUpperInvariant(c))
            throw new NgcException($"expected '{c}' at column {_i}");
    }

    private void SkipSpace()
    {
        while (_i < text.Length && char.IsWhiteSpace(text[_i])) _i++;
    }

    /// <summary>A word's value. Literal numbers come back with their text so they go out exactly as written.</summary>
    public double ReadRealValue(out string? literal)
    {
        literal = null;
        var c = Peek();
        if (c is >= '0' and <= '9' or '.' || ((c is '-' or '+') && NextIsNumber()))
        {
            var start = _i;
            var value = ReadNumber();
            literal = text[start.._i].Replace(" ", "");
            return value;
        }
        return ReadOperand();
    }

    public double ReadRealValue() => ReadRealValue(out _);

    private bool NextIsNumber()
    {
        var j = _i + 1;
        while (j < text.Length && char.IsWhiteSpace(text[j])) j++;
        return j < text.Length && (char.IsDigit(text[j]) || text[j] == '.');
    }

    private double ReadNumber()
    {
        SkipSpace();
        var start = _i;
        if (_i < text.Length && (text[_i] == '-' || text[_i] == '+')) _i++;
        SkipSpace();
        var digitsStart = _i;
        while (_i < text.Length && (char.IsDigit(text[_i]) || text[_i] == '.')) _i++;
        var digits = text[digitsStart.._i];
        if (digits.Length == 0 || digits == "." || digits.Count(ch => ch == '.') > 1)
            throw new NgcException($"bad number at column {start + 1}");
        var value = double.Parse(digits, NumberStyles.Float, CultureInfo.InvariantCulture);
        return text[start] == '-' ? -value : value;
    }

    private double ReadOperand()
    {
        var c = Peek();
        switch (c)
        {
            case '[':
                _i++;
                var inner = ReadBinary(0);
                Expect(']');
                return inner;
            case '#':
                return ReadParameterValue();
            case '-':
                _i++;
                return -ReadOperand();
            case '+':
                _i++;
                return ReadOperand();
        }
        if (c is >= '0' and <= '9' or '.') return ReadNumber();
        if (char.IsLetter(c)) return ReadFunction();
        throw new NgcException(c == '\0' ? "unexpected end of line" : $"unexpected '{c}' at column {_i + 1}");
    }

    private double ReadBinary(int minLevel)
    {
        var lhs = ReadOperand();
        while (true)
        {
            var (op, level, length) = PeekOperator();
            if (op is null || level < minLevel) return lhs;
            _i += length;
            var rhs = ReadBinary(level + 1);
            lhs = Apply(op, lhs, rhs);
        }
    }

    private (string? Op, int Level, int Length) PeekOperator()
    {
        SkipSpace();
        if (_i >= text.Length) return (null, 0, 0);
        var rest = text.AsSpan(_i);
        if (rest.StartsWith("**")) return ("**", 4, 2);
        switch (rest[0])
        {
            case '*': return ("*", 3, 1);
            case '/': return ("/", 3, 1);
            case '+': return ("+", 2, 1);
            case '-': return ("-", 2, 1);
        }
        foreach (var (name, level) in WordOperators)
        {
            if (rest.Length >= name.Length && rest[..name.Length].Equals(name, StringComparison.OrdinalIgnoreCase))
                return (name, level, name.Length);
        }
        return (null, 0, 0);
    }

    private static readonly (string Name, int Level)[] WordOperators =
    [
        ("MOD", 3),
        ("EQ", 1), ("NE", 1), ("GT", 1), ("GE", 1), ("LT", 1), ("LE", 1),
        ("AND", 0), ("OR", 0), ("XOR", 0),
    ];

    private static double Apply(string op, double a, double b) => op switch
    {
        "**" => Math.Pow(a, b),
        "*" => a * b,
        "/" => b == 0 ? throw new NgcException("division by zero") : a / b,
        "MOD" => b == 0 ? throw new NgcException("division by zero") : a - b * Math.Floor(a / b),
        "+" => a + b,
        "-" => a - b,
        "EQ" => Math.Abs(a - b) < EqualTolerance ? 1 : 0,
        "NE" => Math.Abs(a - b) >= EqualTolerance ? 1 : 0,
        "GT" => a > b ? 1 : 0,
        "GE" => a >= b ? 1 : 0,
        "LT" => a < b ? 1 : 0,
        "LE" => a <= b ? 1 : 0,
        "AND" => a != 0 && b != 0 ? 1 : 0,
        "OR" => a != 0 || b != 0 ? 1 : 0,
        "XOR" => (a != 0) != (b != 0) ? 1 : 0,
        _ => throw new NgcException($"unknown operator {op}"),
    };

    private double ReadFunction()
    {
        var start = _i;
        while (_i < text.Length && char.IsLetter(text[_i])) _i++;
        var name = text[start.._i].ToUpperInvariant();

        if (name == "EXISTS")
        {
            Expect('[');
            Expect('#');
            Expect('<');
            var paramName = ReadName();
            Expect(']');
            return parameters.ExistsNamed(paramName) ? 1 : 0;
        }

        if (Peek() != '[') throw new NgcException($"'{name}' is not a function");
        var arg = ReadOperand();

        if (name == "ATAN")
        {
            Expect('/');
            if (Peek() != '[') throw new NgcException("ATAN needs ATAN[y]/[x]");
            var x = ReadOperand();
            return Math.Atan2(arg, x) * 180 / Math.PI;
        }

        return name switch
        {
            "ABS" => Math.Abs(arg),
            "ACOS" => Math.Acos(arg) * 180 / Math.PI,
            "ASIN" => Math.Asin(arg) * 180 / Math.PI,
            "COS" => Math.Cos(arg * Math.PI / 180),
            "SIN" => Math.Sin(arg * Math.PI / 180),
            "TAN" => Math.Tan(arg * Math.PI / 180),
            "EXP" => Math.Exp(arg),
            "FIX" => Math.Floor(arg),
            "FUP" => Math.Ceiling(arg),
            "LN" => arg <= 0 ? throw new NgcException("LN of a value that isn't positive") : Math.Log(arg),
            "ROUND" => Math.Round(arg, MidpointRounding.AwayFromZero),
            "SQRT" => arg < 0 ? throw new NgcException("SQRT of a negative value") : Math.Sqrt(arg),
            _ => throw new NgcException($"unknown function {name}"),
        };
    }

    private string ReadName()
    {
        var end = text.IndexOf('>', _i);
        if (end < 0) throw new NgcException("parameter name has no closing '>'");
        var name = text[_i..end].Replace(" ", "");
        _i = end + 1;
        if (name.Length == 0) throw new NgcException("empty parameter name");
        return name;
    }

    /// <summary>The parameter after a '#' (the '#' not yet read), without reading its value.</summary>
    public NgcParamRef ReadParameterRef()
    {
        Expect('#');
        var c = Peek();
        if (c == '<')
        {
            _i++;
            return new NgcParamRef(null, ReadName());
        }
        double index = c switch
        {
            '[' => ReadOperand(),
            '#' => ReadParameterValue(),
            _ => ReadNumber(),
        };
        var rounded = Math.Round(index);
        if (Math.Abs(index - rounded) > 0.0001 || rounded < 1)
            throw new NgcException($"parameter number {index.ToString(CultureInfo.InvariantCulture)} is not valid");
        return new NgcParamRef((int)rounded, null);
    }

    private double ReadParameterValue()
    {
        var p = ReadParameterRef();
        return p.Name is { } name ? parameters.GetNamed(name) : parameters.Get(p.Number!.Value);
    }
}
