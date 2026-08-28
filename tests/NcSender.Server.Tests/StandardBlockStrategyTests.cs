using NcSender.Server.Probing.Strategies;

namespace NcSender.Server.Tests;

public class StandardBlockStrategyTests
{
    [Fact]
    public void ZProbeRoutine_UsesDefaultSecondProbeDelay()
    {
        var routine = StandardBlockStrategy.GetZProbeRoutine();

        Assert.Contains("G4 P0.1", routine);
    }

    [Fact]
    public void ZProbeRoutine_UsesCustomSecondProbeDelay()
    {
        var routine = StandardBlockStrategy.GetZProbeRoutine(secondProbeDelay: 0.5);

        Assert.Contains("G4 P0.5", routine);
    }

    [Fact]
    public void ZProbeRoutine_UsesCustomProbeFeedratesAndRetractDistance()
    {
        var routine = StandardBlockStrategy.GetZProbeRoutine(
            retractDistance: 2,
            firstProbeFeedrate: 300,
            secondProbeFeedrate: 40);

        Assert.Contains("G38.2 Z-30 F300", routine);
        Assert.Contains("G0 Z2", routine);
        Assert.Contains("G38.2 Z-3 F40", routine);
    }
}
