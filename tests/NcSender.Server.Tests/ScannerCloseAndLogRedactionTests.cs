using System.Diagnostics;
using NcSender.Server;
using NcSender.Server.Pendant;

namespace NcSender.Server.Tests;

public class ScannerCloseAndLogRedactionTests
{
    // A serial port that never finishes closing must not hold the scan: that
    // is what left a replugged Wireless USB undetected until a restart.
    [Fact]
    public async Task RunBounded_GivesUpOnWorkThatNeverFinishes()
    {
        var never = new TaskCompletionSource();
        var sw = Stopwatch.StartNew();

        var finished = await PendantPortScanner.RunBoundedAsync(() => never.Task, TimeSpan.FromMilliseconds(150));

        Assert.False(finished);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(3), $"took {sw.Elapsed}");
    }

    [Fact]
    public async Task RunBounded_DoesNotReturnWhenWorkBlocksItsThread()
    {
        using var gate = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        var finished = await PendantPortScanner.RunBoundedAsync(() => { gate.Wait(); return Task.CompletedTask; }, TimeSpan.FromMilliseconds(150));

        Assert.False(finished);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(3), $"took {sw.Elapsed}");
        gate.Set();
    }

    [Fact]
    public async Task RunBounded_ReportsWorkThatFinishes_EvenWhenItThrows()
    {
        Assert.True(await PendantPortScanner.RunBoundedAsync(() => Task.CompletedTask, TimeSpan.FromSeconds(2)));
        Assert.True(await PendantPortScanner.RunBoundedAsync(() => throw new IOException("port gone"), TimeSpan.FromSeconds(2)));
    }

    [Fact]
    public void Redact_MasksTheWifiPassword()
    {
        var logged = RequestLogRedactor.Redact("{\"ssid\":\"Shop\",\"password\":\"hunter2 \\\"quoted\\\"\"}");

        Assert.Equal("{\"ssid\":\"Shop\",\"password\":\"***\"}", logged);
    }

    [Theory]
    [InlineData("{\"Password\" : \"x\"}", "{\"Password\" : \"***\"}")]
    [InlineData("{\"token\":\"abc\",\"n\":1}", "{\"token\":\"***\",\"n\":1}")]
    [InlineData("{\"wifi\":{\"psk\":\"abc\"}}", "{\"wifi\":{\"psk\":\"***\"}}")]
    public void Redact_MasksOtherSecretFields(string body, string expected) =>
        Assert.Equal(expected, RequestLogRedactor.Redact(body));

    [Theory]
    [InlineData("{\"spindleView\":true}")]
    [InlineData("{\"mode\":\"wireless\",\"expandCommand\":\"M8\"}")]
    [InlineData("{\"passwordHint\":\"none\"}")]
    [InlineData("")]
    public void Redact_LeavesEverythingElseAlone(string body) =>
        Assert.Equal(body, RequestLogRedactor.Redact(body));
}
