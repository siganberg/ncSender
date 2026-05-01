using NcSender.Server.Protocols.FluidNc;
using NcSender.Server.Protocols.GrblHal;

namespace NcSender.Server.Tests;

// Greeting detection guards auto-connect: the moment a protocol declares
// "this is mine", AutoConnectService treats the controller as identified.
// Matching too loosely (e.g. on the FluidNC banner that arrives ~5s before
// the controller is actually ready) trips the connection sequence and
// leaves the user in an endless retry loop. These tests pin the canonical
// "Grbl X.Y ... '$' for help" greeting line as the ONLY match for both
// grblHAL and FluidNC, with all the boot-time noise rejected.
public class ProtocolGreetingTests
{
    private readonly FluidNcProtocol _fluidnc = new();
    private readonly GrblHalProtocol _grblhal = new();

    // === FluidNC: the banner is NOT a greeting ===
    // Captured from a real Windows + FluidNC v4.0.1 boot sequence.

    [Theory]
    [InlineData("[MSG:INFO: FluidNC v4.0.1 https://github.com/bdring/FluidNC]")]
    [InlineData("[MSG:INFO: Local filesystem type is littlefs]")]
    [InlineData("[MSG:INFO: Configuration file:config.yaml]")]
    [InlineData("[MSG:INFO: Machine XYZ_CNC_Router]")]
    [InlineData("[MSG:INFO: Board PiBotV49P]")]
    [InlineData("[MSG:INFO: Axis count 4]")]
    [InlineData("[MSG:INFO: Connecting to STA SSID:ChieWireless]")]
    [InlineData("[MSG:INFO: Connecting.]")]
    [InlineData("[MSG:INFO: Start mDNS with hostname:http://fluidnc.local/]")]
    [InlineData("[MSG:INFO: HTTP started on port 80]")]
    [InlineData("[MSG:INFO: Telnet started on port 23]")]
    [InlineData("[MSG:INFO: Probe gpio.2:low:pu]")]
    public void FluidNc_DoesNotMatchBootBanners(string line)
    {
        Assert.False(_fluidnc.MatchesGreeting(line),
            $"FluidNC banner / boot message should not match greeting: {line}");
    }

    // === FluidNC: the canonical Grbl greeting line IS a greeting ===

    [Theory]
    [InlineData("Grbl 4.0 [FluidNC v4.0.1 (wifi) '$' for help]")]
    [InlineData("Grbl 4.0 [FluidNC v4.0.1 (esp32s3-wifi) '$' for help]")]
    [InlineData("Grbl 3.7 [FluidNC v3.7.18 (wifi) '$' for help]")]
    public void FluidNc_MatchesCanonicalGreeting(string line)
    {
        Assert.True(_fluidnc.MatchesGreeting(line),
            $"FluidNC canonical greeting should match: {line}");
    }

    // === grblHAL ===

    [Theory]
    [InlineData("GrblHAL 1.1f ['$' or '$HELP' for help]")]
    [InlineData("Grbl 1.1h ['$' for help]")]
    public void GrblHal_MatchesCanonicalGreeting(string line)
    {
        Assert.True(_grblhal.MatchesGreeting(line),
            $"grblHAL greeting should match: {line}");
    }

    [Theory]
    [InlineData("Grbl 4.0 [FluidNC v4.0.1 (wifi) '$' for help]")] // FluidNC announces itself with Grbl prefix; must not collide
    [InlineData("[MSG:INFO: FluidNC v4.0.1 https://github.com/bdring/FluidNC]")]
    [InlineData("ok")]
    [InlineData("<Idle|MPos:0.000,0.000,0.000|FS:0,0>")]
    public void GrblHal_DoesNotMatchOtherProtocolsOrNoise(string line)
    {
        Assert.False(_grblhal.MatchesGreeting(line),
            $"grblHAL should not match: {line}");
    }

    // === Cross-firmware exclusivity: every line we recognise belongs to
    //     exactly one protocol (or none — never both at once). ===

    [Theory]
    [InlineData("Grbl 4.0 [FluidNC v4.0.1 (wifi) '$' for help]")]
    [InlineData("GrblHAL 1.1f ['$' or '$HELP' for help]")]
    [InlineData("[MSG:INFO: FluidNC v4.0.1 https://github.com/bdring/FluidNC]")]
    [InlineData("ok")]
    public void Greeting_AtMostOneProtocolMatches(string line)
    {
        var hits = (_fluidnc.MatchesGreeting(line) ? 1 : 0)
                 + (_grblhal.MatchesGreeting(line) ? 1 : 0);
        Assert.True(hits <= 1, $"More than one protocol matched line: {line}");
    }
}
