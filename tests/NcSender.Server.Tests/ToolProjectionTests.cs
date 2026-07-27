using Microsoft.Extensions.Logging.Abstractions;

namespace NcSender.Server.Tests;

public class ToolProjectionTests
{
    private static NcSender.Server.CommandProcessor.ToolProjection Create() =>
        new(NullLogger<NcSender.Server.CommandProcessor.ToolProjection>.Instance);

    [Fact]
    public void WithNothingQueued_ReadsThroughToObservedTool()
    {
        var projection = Create();

        Assert.Equal(3, projection.EffectiveToolFor(3));
        Assert.Equal(5, projection.EffectiveToolFor(5));
    }

    [Fact]
    public void QueuedChange_TakesPrecedenceOverObservedTool()
    {
        var projection = Create();

        projection.ToolChangeQueued(0);

        Assert.Equal(0, projection.EffectiveToolFor(1));
    }

    [Fact]
    public void IntermediateObservation_DoesNotClearPendingChange()
    {
        // Batch: M6 T0 then M6 T1. The controller reports T0 partway through;
        // the trailing change to T1 is still outstanding and must survive.
        var projection = Create();

        projection.ToolChangeQueued(0);
        projection.ToolChangeQueued(1);

        projection.ActualToolObserved(0);

        Assert.Equal(1, projection.EffectiveToolFor(0));
    }

    [Fact]
    public void ObservingTheLastQueuedTool_ClearsProjectionOnceSettled()
    {
        var projection = Create();

        projection.ToolChangeQueued(1);
        projection.ToolChangeCompleted();
        projection.ActualToolObserved(1);

        // Projection is redundant now — observed state is authoritative again.
        Assert.Equal(4, projection.EffectiveToolFor(4));
    }

    [Fact]
    public void ObservationMatchingPendingTool_DoesNotClearWhileChangesOutstanding()
    {
        // T1 loaded, batch queues M6 T0 then M6 T1. Nothing has executed yet,
        // so status reports still say T1 — which equals the pending tool. That
        // coincidence must not retire a projection with work still queued.
        var projection = Create();

        projection.ToolChangeQueued(0);
        projection.ToolChangeQueued(1);

        // The coincidental report, then the first change really lands (T0).
        projection.ActualToolObserved(1);
        projection.ActualToolObserved(0);

        // Still projecting T1. Had the T1 report retired it, the fallback
        // would now be the freshly observed T0 and the trailing M6 T1 would
        // be built as a load-on-top-of-loaded.
        Assert.Equal(1, projection.EffectiveToolFor(0));
    }

    [Fact]
    public void ProjectionSurvivesUntilEveryQueuedChangeCompletes()
    {
        var projection = Create();

        projection.ToolChangeQueued(0);
        projection.ToolChangeQueued(1);

        projection.ToolChangeCompleted();
        Assert.Equal(1, projection.EffectiveToolFor(0));

        projection.ToolChangeCompleted();
        Assert.Equal(9, projection.EffectiveToolFor(9));
    }

    [Fact]
    public void SurplusCompletions_DoNotDriveTheCountNegative()
    {
        // A $TLS emits the same sentinel, so completions can outnumber queued
        // M6s. That must not leave the counter negative and wedge the next
        // real change.
        var projection = Create();

        projection.ToolChangeCompleted();
        projection.ToolChangeCompleted();

        projection.ToolChangeQueued(5);
        Assert.Equal(5, projection.EffectiveToolFor(1));

        projection.ToolChangeCompleted();
        Assert.Equal(1, projection.EffectiveToolFor(1));
    }

    [Fact]
    public void Reset_FallsBackToObservedTool()
    {
        // A soft reset flushes the queue, so a projected change never runs.
        var projection = Create();

        projection.ToolChangeQueued(7);
        projection.Reset();

        Assert.Equal(2, projection.EffectiveToolFor(2));
    }

    [Fact]
    public void PasteScenario_ProducesLoadUnloadLoad()
    {
        // M6 T1 / M6 T0 / M6 T1 expanded back to back with T0 observed
        // throughout — the sequence that dropped the unload and ran two
        // consecutive loads.
        var projection = Create();
        const int observed = 0;

        var first = projection.EffectiveToolFor(observed);
        projection.ToolChangeQueued(1);
        var second = projection.EffectiveToolFor(observed);
        projection.ToolChangeQueued(0);
        var third = projection.EffectiveToolFor(observed);

        Assert.Equal(0, first);   // nothing loaded → load T1
        Assert.Equal(1, second);  // T1 loaded → M6 T0 is a real unload
        Assert.Equal(0, third);   // empty again → load T1, no unload half
    }
}
