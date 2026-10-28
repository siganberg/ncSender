using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

/// <summary>
/// Turns one line, as the rest of ncSender writes it, into what the connected
/// controller can run (see <see cref="IProtocolHandler.CreateTranslator"/>).
/// Lines are translated one at a time, each after the previous one was
/// answered, so values read from the controller (probe results, offsets) are
/// current when an expression uses them.
/// </summary>
public interface IGcodeTranslator
{
    /// <summary>Translate one source line. Applies its assignments and o-word flow.</summary>
    TranslationResult Translate(string line);

    /// <summary>A line the controller reported (probe results, parser state).</summary>
    void ObserveData(string line);

    /// <summary>A translated line was rejected: the sequence it belonged to is over.</summary>
    void OnLineFailed();

    /// <summary>Controller reset or queue flushed: drop o-word state, parser state is back to defaults.</summary>
    void Reset();

    /// <summary>
    /// A controller line as ncSender should read it. Lets a translator make up
    /// for what the controller gets wrong or forgets (classic Grbl's tool) or
    /// reports in its own way (FluidNC); unchanged by default. Null drops the
    /// line: nothing in ncSender should see it.
    /// </summary>
    string? CorrectReport(string line) => line;
}

public enum TranslationKind
{
    /// <summary>Run <see cref="TranslationResult.Steps"/> in order (may be none: a comment or an assignment).</summary>
    Run,
    /// <summary>Send <see cref="TranslationResult.SyncCommand"/> first, then translate the same line again.</summary>
    Sync,
    /// <summary>The line can't run on this controller; <see cref="TranslationResult.Error"/> says why.</summary>
    Fail,
}

/// <summary>One step of a translated line: a line to write, or a message to report as if the controller had sent it.</summary>
public readonly record struct TranslationStep(string? Write, string? Message)
{
    public static TranslationStep Line(string line) => new(line, null);
    public static TranslationStep Report(string data) => new(null, data);
}

public sealed record TranslationResult(TranslationKind Kind, IReadOnlyList<TranslationStep> Steps, string? SyncCommand = null, string? Error = null)
{
    public static readonly TranslationResult Nothing = new(TranslationKind.Run, []);
    public static TranslationResult Run(params TranslationStep[] steps) => new(TranslationKind.Run, steps);
    public static TranslationResult Sync(string command) => new(TranslationKind.Sync, [], command);
    public static TranslationResult Failed(string error) => new(TranslationKind.Fail, [], Error: error);
}
