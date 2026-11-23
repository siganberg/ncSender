using System.Text.RegularExpressions;

namespace NcSender.Server;

/// <summary>
/// Keeps secrets out of the API request log. The log quotes the body of every
/// small POST, PUT and PATCH, and logs travel: they are attached to support
/// tickets and read over remote support. Joining a Wi-Fi network wrote its
/// password there in plain text.
///
/// Matched on the text rather than parsed, so it also covers a body that is
/// not quite JSON, and it never changes what the endpoint itself receives.
/// </summary>
internal static partial class RequestLogRedactor
{
    public const string Mask = "***";

    [GeneratedRegex(
        "(\"(?:password|passphrase|psk|secret|token|apiKey|licenseKey)\"\\s*:\\s*)\"(?:\\\\.|[^\"\\\\])*\"",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SecretField();

    public static string Redact(string body) =>
        string.IsNullOrEmpty(body) ? body : SecretField().Replace(body, "$1\"" + Mask + "\"");
}
