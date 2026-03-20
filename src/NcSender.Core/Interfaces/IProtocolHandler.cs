using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IProtocolHandler
{
    string Name { get; }

    /// <summary>
    /// Protocol key used for cache directories (e.g. "grblhal", "fluidnc").
    /// </summary>
    string CacheKey { get; }

    /// <summary>
    /// Returns true if this handler recognizes the greeting line.
    /// </summary>
    bool MatchesGreeting(string line);

    /// <summary>
    /// Returns init commands to send after the first status report is received.
    /// </summary>
    string[] GetInitCommands();

    /// <summary>
    /// Optional real-time byte to request a full status report on connect (e.g. 0x87 for grblHAL).
    /// Returns null if not supported.
    /// </summary>
    byte? FullStatusRequestByte => null;

    /// <summary>
    /// The command to fetch alarm codes from the controller.
    /// </summary>
    string AlarmFetchCommand { get; }

    /// <summary>
    /// Parse an alarm data line. Returns (id, description) or null if not an alarm line.
    /// </summary>
    (string Id, string Description)? ParseAlarmLine(string line);

    /// <summary>
    /// The command to fetch error codes from the controller. Null if not supported.
    /// </summary>
    string? ErrorFetchCommand => null;

    /// <summary>
    /// Parse an error code data line (e.g. [ERRORCODE:N||description]).
    /// Returns (id, description) or null if not an error line.
    /// </summary>
    (string Id, string Description)? ParseErrorLine(string line) => null;

    /// <summary>
    /// Normalize the Pn (pin state) string after status report parsing.
    /// Allows protocol-specific mapping of probe/TLS indicators.
    /// </summary>
    string NormalizePinState(string pn, int activeProbe, int tlsIndex = 0, int probeCount = 0);

    /// <summary>
    /// Whether this protocol supports dynamic setting enumeration ($EG, $ES, $ESH).
    /// If false, GetStaticSettingDefinitions() provides the metadata.
    /// </summary>
    bool SupportsSettingEnumeration => true;

    /// <summary>
    /// Post-process the status report after all fields are parsed.
    /// Used for protocol-specific state inference (e.g. homing detection).
    /// </summary>
    void PostProcessStatus(MachineState state, string previousStatus) { }

    /// <summary>
    /// Try to handle a controller-specific data line (e.g. [PARAM:...], [AXS:...]).
    /// Returns true if the line was handled and should not be processed further.
    /// </summary>
    bool TryHandleData(string line, MachineState state, out bool stateChanged);

    /// <summary>
    /// Parse an error line and return the error code and message.
    /// Returns true if this handler recognized the error format.
    /// </summary>
    bool TryParseError(string line, out int? errorCode, out string errorMessage);

    /// <summary>
    /// Returns true if the given command requires a $G refresh to detect state changes
    /// (e.g. workspace switches on protocols that don't report WCS in status reports).
    /// </summary>
    bool NeedsGCodeStateRefresh(string command) => false;
}
