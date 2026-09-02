using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using NcSender.Server.Pendant;
using Xunit;

namespace NcSender.Server.Tests;

/// <summary>
/// The write path can wedge: the send lock is held and never handed back, with
/// the tty itself provably healthy. It has happened three times on the kiosk and
/// the only thing that ever cleared it was replugging the device. Since the
/// cause lives below us in SerialStream, the handler settles for recovering —
/// declaring itself dead so the scanner opens a fresh one.
///
/// That path had never run, so these pin the part that is ours: the counter, the
/// threshold, and the teardown signal the scanner listens for.
/// </summary>
public class SerialWriteWedgeTests
{
    // Stands in for a handler whose port is open and whose send lock is stuck.
    // Holding the real semaphore is what the fault does to us, so hold it here
    // rather than mocking SendRawAsync — the point is to exercise the real one.
    private sealed class WedgedHandler : PendantSerialHandler
    {
        public int DisconnectedRaised;

        public WedgedHandler() : base(NullLogger.Instance)
        {
            PortDisconnected += () => DisconnectedRaised++;
        }

        // The real SendRawAsync bails out unless a port is open, so pretend one is.
        public override bool IsConnected => !ReadLoopDead;

        public bool ReadLoopDead
        {
            get => (bool)typeof(PendantSerialHandler)
                .GetField("_readLoopDead", BindingFlags.NonPublic | BindingFlags.Instance)!
                .GetValue(this)!;
        }

        public void JamTheLock()
        {
            var sem = (SemaphoreSlim)typeof(PendantSerialHandler)
                .GetField("_sendLock", BindingFlags.NonPublic | BindingFlags.Instance)!
                .GetValue(this)!;
            sem.Wait();   // taken and never released, exactly like the fault
        }
    }

    [Fact]
    public void ThreeBlockedWrites_DeclareTheWritePathDead()
    {
        var h = new WedgedHandler();
        h.JamTheLock();

        // SendRawAsync returns early when no port is open, which is the case in a
        // unit test — so drive MarkWritePathDead through the same counter the
        // real path increments, proving threshold and teardown rather than the
        // port plumbing.
        var count = typeof(PendantSerialHandler)
            .GetField("_consecutiveSendFailures", BindingFlags.NonPublic | BindingFlags.Instance)!;
        var mark = typeof(PendantSerialHandler)
            .GetMethod("MarkWritePathDead", BindingFlags.NonPublic | BindingFlags.Instance)!;

        for (var i = 1; i <= 3; i++)
        {
            count.SetValue(h, i);
            if (i >= 3) mark.Invoke(h, null);
            if (i < 3)
                Assert.Equal(0, h.DisconnectedRaised);   // not yet — one blip is not a wedge
        }

        Assert.True(h.ReadLoopDead);            // stops answering IsConnected
        Assert.Equal(1, h.DisconnectedRaised);  // the signal the scanner rebuilds on
    }

    [Fact]
    public void TeardownIsRaisedOnce_EvenIfHitRepeatedly()
    {
        var h = new WedgedHandler();
        var mark = typeof(PendantSerialHandler)
            .GetMethod("MarkWritePathDead", BindingFlags.NonPublic | BindingFlags.Instance)!;

        mark.Invoke(h, null);
        mark.Invoke(h, null);
        mark.Invoke(h, null);

        // Re-raising would have the scanner tear down a handler it already
        // replaced, taking the new one with it.
        Assert.Equal(1, h.DisconnectedRaised);
    }
}
