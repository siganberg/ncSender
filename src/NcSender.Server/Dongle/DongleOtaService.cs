using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Dongle;

/// <summary>
/// Generic wireless-OTA sender. Streams a firmware .bin to any dongle-attached
/// device by name — the service knows nothing about AutoDustBoot specifically,
/// so any plugin whose device advertises the shared ESPNOW_OTA_* protocol can
/// use it (RGB LED controller, future accessories, etc.).
///
/// Wire framing (dongle firmware sees each line, translates to ESPNOW_OTA_*):
///   $OTA:BEGIN @&lt;name&gt; &lt;session&gt; &lt;total&gt; &lt;chunk&gt; &lt;md5hex&gt;
///   $OTA:CHUNK @&lt;name&gt; &lt;session&gt; &lt;seq&gt; &lt;dataLen&gt; &lt;base64&gt;
///   $OTA:END   @&lt;name&gt; &lt;session&gt; &lt;total&gt; &lt;md5hex&gt;
/// Device replies (arrive as DeviceMessageReceived payloads):
///   $OTA:ACK &lt;session&gt; &lt;seq&gt; &lt;status&gt;
///
/// Sliding window of up to <see cref="WindowSize"/> chunks in flight. Device
/// enforces strict in-order writes and sends OUT_OF_ORDER with expected-next
/// on the seq field — we back-fill immediately without waiting for a timeout.
/// Progress + errors emit on plugin-ota:* so plugins can share one WS
/// subscription across USB and wireless flashes.
/// </summary>
public sealed class DongleOtaService : IDisposable
{
    // Chunk sizing: 200 B data + 10 B header = 210 B, well under the 246 B
    // ESP-NOW payload cap (leaves room for future header growth). 766 KB
    // firmware = ~3830 chunks.
    private const int ChunkSize = 200;
    // 4 chunks in flight matches the design decision; increase if bandwidth
    // is left on the table but watch for out-of-order thrash first.
    private const int WindowSize = 4;
    private const int PerChunkAckTimeoutMs = 800;
    private const int MaxRetriesPerChunk = 6;
    // Devices ACK BEGIN synchronously AFTER their Update.begin() call returns,
    // and Update.begin() has to erase the target OTA partition — that's a
    // multi-second flash operation. Small-partition devices (AutoDustBoot,
    // RGB LED ~1 MB) come back in <2 s; pendants (3 MB OTA slot) can take
    // 8-10 s. The budget below is set for the worst offender so BEGIN doesn't
    // spuriously fail on the largest device; a device that's genuinely offline
    // still fails in a few seconds because the ACK simply never arrives.
    private const int BeginAckTimeoutMs = 12000;  // per-attempt
    private const int BeginRetries = 2;           // 2 × 12 s = 24 s total budget for the handshake
    private const int EndAckTimeoutMs = 15000;

    private readonly ILogger<DongleOtaService> _logger;
    private readonly IDongleDeviceService _dongle;
    private readonly IBroadcaster _broadcaster;
    private readonly ConcurrentDictionary<string, Session> _sessions
        = new(StringComparer.OrdinalIgnoreCase);
    private readonly HttpClient _http = new();

    public DongleOtaService(
        ILogger<DongleOtaService> logger,
        IDongleDeviceService dongle,
        IBroadcaster broadcaster)
    {
        _logger = logger;
        _dongle = dongle;
        _broadcaster = broadcaster;
        _dongle.DeviceMessageReceived += OnDongleMessage;
    }

    public Task FlashAsync(string deviceName, byte[] firmware, string? deviceId, CancellationToken ct)
        => FlashAsync(deviceName, firmware, deviceId, ct, onProgress: null);

    public async Task FlashAsync(string deviceName, byte[] firmware, string? deviceId,
                                 CancellationToken ct, Action<int>? onProgress)
    {
        if (firmware is null || firmware.Length == 0)
            throw new ArgumentException("Firmware payload is empty");
        if (string.IsNullOrWhiteSpace(deviceName))
            throw new ArgumentException("Device name is required");

        // One flash at a time per device — a second call cancels the first.
        if (_sessions.TryRemove(deviceName, out var prev))
            prev.Abort("Superseded by a new flash request");

        var s = new Session(deviceName, firmware, deviceId ?? deviceName) { OnProgress = onProgress };
        _sessions[deviceName] = s;

        try
        {
            await FlashInternalAsync(s, ct);
            await BroadcastDoneAsync(s);
        }
        catch (OperationCanceledException)
        {
            await BroadcastErrorAsync(s, "Wireless firmware update was cancelled");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wireless OTA failed for '{Name}'", deviceName);
            await BroadcastErrorAsync(s, ex.Message);
            throw;
        }
        finally
        {
            _sessions.TryRemove(deviceName, out _);
        }
    }

    public async Task FlashFromUrlAsync(string deviceName, string downloadUrl, string? deviceId, CancellationToken ct)
    {
        // Server-side download bypasses browser CORS on GitHub Release assets —
        // same reason the USB flow has a /flash-from-url variant.
        await BroadcastMessageAsync(deviceName, deviceId ?? deviceName, "info",
            $"Downloading firmware from {downloadUrl}…");
        byte[] bytes;
        try
        {
            bytes = await _http.GetByteArrayAsync(downloadUrl, ct);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Download failed: {ex.Message}");
        }
        await FlashAsync(deviceName, bytes, deviceId, ct);
    }

    public void Cancel(string deviceName)
    {
        if (_sessions.TryRemove(deviceName, out var s))
            s.Abort("Wireless firmware update was cancelled");
    }

    // ---------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------

    private async Task FlashInternalAsync(Session s, CancellationToken outerCt)
    {
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(outerCt, s.Cts.Token);
        var ct = linkedCts.Token;

        // 1. BEGIN — retry a few times. A single BEGIN packet can be lost
        // on the shared ESP-NOW channel (especially if pendant traffic
        // contends with it), and the device drains its RX queue quickly
        // enough that resending is safe: it either sees the first packet
        // and ACKs (later BEGINs cancel-and-restart the same session id)
        // or it sees only the retry.
        await BroadcastMessageAsync(s, "info", $"Starting wireless flash ({s.Firmware.Length:N0} bytes)");
        var beginLine = $"$OTA:BEGIN @{s.DeviceName} {s.SessionId} {s.Firmware.Length} {ChunkSize} {s.Md5Hex}";
        OtaStatus? beginAck = null;
        for (var attempt = 0; attempt < BeginRetries; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            await SendAsync(s, beginLine);
            try
            {
                beginAck = await AwaitAckAsync(s, 0, BeginAckTimeoutMs, ct);
                break;
            }
            catch (TimeoutException)
            {
                _logger.LogWarning("[OTA {Name}] BEGIN ack timeout (attempt {N}/{Max})",
                    s.DeviceName, attempt + 1, BeginRetries);
                if (attempt == BeginRetries - 1)
                    throw new TimeoutException(
                        $"No BEGIN ack after {BeginRetries} attempts. Device may be offline, on a firmware older than v1.0.4, or the wireless link is unusable.");
            }
        }
        if (beginAck != OtaStatus.Ok)
            throw new InvalidOperationException($"Device rejected BEGIN (status={beginAck})");

        // 2. Stream chunks with a sliding window.
        int totalChunks = (s.Firmware.Length + ChunkSize - 1) / ChunkSize;
        s.TotalChunks = totalChunks;

        // Chunks currently in flight, keyed by seq. Value carries send time
        // and retry count — the reaper walks this dictionary every tick.
        var inFlight = new Dictionary<uint, InFlight>();
        uint nextToSend = 0;
        uint nextExpectedAck = 0;   // for progress calc + logging
        int lastPctBroadcast = -1;

        while (nextExpectedAck < totalChunks)
        {
            ct.ThrowIfCancellationRequested();

            // Fill the window.
            while (inFlight.Count < WindowSize && nextToSend < totalChunks)
            {
                await SendChunkAsync(s, nextToSend);
                inFlight[nextToSend] = new InFlight { SentAtMs = NowMs(), Retries = 0 };
                nextToSend++;
            }

            // Wait for an ACK (or timeout on the earliest in-flight chunk).
            var earliestTimeoutMs = inFlight.Values.Min(f => (f.SentAtMs + PerChunkAckTimeoutMs) - NowMs());
            int waitMs = Math.Max(10, (int)earliestTimeoutMs);

            var ack = await s.AckChannel.WaitAsync(waitMs, ct);
            if (ack is not null)
            {
                if (ack.Value.status == OtaStatus.Ok)
                {
                    // Duplicate ACK for a chunk we already advanced past is fine.
                    if (inFlight.Remove(ack.Value.seq))
                    {
                        // If the device sends OK for seq N, we can also treat
                        // earlier in-flight chunks as delivered (their ACKs may
                        // be in flight or lost). Only advance the "expected"
                        // marker when the LOWEST in-flight is acked.
                        while (nextExpectedAck < nextToSend && !inFlight.ContainsKey(nextExpectedAck))
                            nextExpectedAck++;

                        var pct = (int)(100L * nextExpectedAck / totalChunks);
                        if (pct != lastPctBroadcast)
                        {
                            lastPctBroadcast = pct;
                            await BroadcastProgressAsync(s, pct);
                            try { s.OnProgress?.Invoke(pct); } catch { /* caller's problem */ }
                        }
                    }
                }
                else if (ack.Value.status == OtaStatus.OutOfOrder)
                {
                    // Device tells us its expected-next in `seq`. Roll back
                    // and retransmit from there — everything past that dropped.
                    uint expected = ack.Value.seq;
                    _logger.LogWarning("[OTA {Name}] device out-of-order, expected={Expected}", s.DeviceName, expected);
                    inFlight.Clear();
                    nextToSend = expected;
                    nextExpectedAck = expected;
                }
                else if (ack.Value.status == OtaStatus.StaleSession || ack.Value.status == OtaStatus.NoSession)
                {
                    throw new InvalidOperationException($"Device lost session (status={ack.Value.status})");
                }
                else
                {
                    throw new InvalidOperationException($"Device aborted OTA (status={ack.Value.status})");
                }
            }
            else
            {
                // ACK timeout — resend the earliest in-flight chunk.
                var stalestSeq = inFlight.OrderBy(kv => kv.Value.SentAtMs).First().Key;
                var f = inFlight[stalestSeq];
                if (++f.Retries > MaxRetriesPerChunk)
                    throw new InvalidOperationException(
                        $"No ACK for chunk {stalestSeq} after {MaxRetriesPerChunk} retries");
                _logger.LogDebug("[OTA {Name}] retry chunk {Seq} attempt {N}", s.DeviceName, stalestSeq, f.Retries);
                await SendChunkAsync(s, stalestSeq);
                f.SentAtMs = NowMs();
                inFlight[stalestSeq] = f;
            }
        }

        // 3. END + verify.
        await BroadcastMessageAsync(s, "info", "All chunks delivered — verifying MD5…");
        await SendAsync(s, $"$OTA:END @{s.DeviceName} {s.SessionId} {s.Firmware.Length} {s.Md5Hex}");
        var endStatus = await AwaitAckAsync(s, EndAckSeq, EndAckTimeoutMs, ct);
        if (endStatus != OtaStatus.Ok)
            throw new InvalidOperationException($"Device rejected END (status={endStatus})");

        await BroadcastMessageAsync(s, "info", "Verified — device rebooting into new firmware");
    }

    private async Task SendChunkAsync(Session s, uint seq)
    {
        int offset = (int)seq * ChunkSize;
        int len = Math.Min(ChunkSize, s.Firmware.Length - offset);
        var slice = new ArraySegment<byte>(s.Firmware, offset, len);
        var b64 = Convert.ToBase64String(slice.Array!, slice.Offset, slice.Count);
        await SendAsync(s, $"$OTA:CHUNK @{s.DeviceName} {s.SessionId} {seq} {len} {b64}");
    }

    // OTA lines are dongle-parser commands ($OTA:BEGIN/CHUNK/END) — they
    // must arrive on USB verbatim, not wrapped in "@name". Use the raw
    // sender bypass rather than SendAsync (which would prepend @name).
    private Task SendAsync(Session s, string line) => _dongle.SendRawLineAsync(line);

    private async Task<OtaStatus> AwaitAckAsync(Session s, uint seq, int timeoutMs, CancellationToken ct)
    {
        var deadline = NowMs() + timeoutMs;
        while (true)
        {
            var remaining = (int)Math.Max(1, deadline - NowMs());
            var ack = await s.AckChannel.WaitAsync(remaining, ct);
            if (ack is null) throw new TimeoutException($"No ACK for seq {seq}");
            if (ack.Value.seq == seq || ack.Value.status != OtaStatus.Ok)
                return ack.Value.status;
            // Otherwise it's a stale chunk ack from earlier — keep waiting.
        }
    }

    // Called by DongleDeviceService for every parsed "@<name> <payload>" line.
    // We watch for "$OTA:ACK <session> <seq> <status>" and route to the
    // active session (if any) for that device.
    private void OnDongleMessage(string name, string payload)
    {
        if (!payload.StartsWith("$OTA:ACK ", StringComparison.Ordinal)) return;
        if (!_sessions.TryGetValue(name, out var s)) return;

        var parts = payload.Substring(9).Split(' ');
        if (parts.Length < 3) return;
        if (!uint.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var sess)) return;
        if (!uint.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var seq)) return;
        if (!int.TryParse(parts[2],  NumberStyles.Integer, CultureInfo.InvariantCulture, out var status)) return;
        if (sess != s.SessionId) return;   // stale from a prior attempt
        s.AckChannel.Push((seq, (OtaStatus)status));
    }

    // -------- broadcast helpers (match plugin-ota:* used by USB OTA) --------

    private Task BroadcastProgressAsync(Session s, int percent)
        => _broadcaster.Broadcast("plugin-ota:progress",
            JsonSerializer.SerializeToElement(new DongleOtaEvent
            {
                DeviceId = s.DeviceId, Device = s.DeviceName, Percent = percent
            }, NcSenderJsonContext.Default.DongleOtaEvent),
            NcSenderJsonContext.Default.JsonElement);

    private Task BroadcastMessageAsync(Session s, string type, string content)
        => BroadcastMessageAsync(s.DeviceName, s.DeviceId, type, content);

    private Task BroadcastMessageAsync(string deviceName, string deviceId, string type, string content)
        => _broadcaster.Broadcast("plugin-ota:message",
            JsonSerializer.SerializeToElement(new DongleOtaEvent
            {
                DeviceId = deviceId, Device = deviceName, Type = type, Message = content
            }, NcSenderJsonContext.Default.DongleOtaEvent),
            NcSenderJsonContext.Default.JsonElement);

    private Task BroadcastErrorAsync(Session s, string error)
        => _broadcaster.Broadcast("plugin-ota:error",
            JsonSerializer.SerializeToElement(new DongleOtaEvent
            {
                DeviceId = s.DeviceId, Device = s.DeviceName, Type = "error", Message = error
            }, NcSenderJsonContext.Default.DongleOtaEvent),
            NcSenderJsonContext.Default.JsonElement);

    private Task BroadcastDoneAsync(Session s)
        => _broadcaster.Broadcast("plugin-ota:done",
            JsonSerializer.SerializeToElement(new DongleOtaEvent
            {
                DeviceId = s.DeviceId, Device = s.DeviceName, Percent = 100
            }, NcSenderJsonContext.Default.DongleOtaEvent),
            NcSenderJsonContext.Default.JsonElement);

    private static long NowMs() => Environment.TickCount64;

    public void Dispose()
    {
        _dongle.DeviceMessageReceived -= OnDongleMessage;
        foreach (var s in _sessions.Values) s.Abort("Service shutting down");
        _sessions.Clear();
        _http.Dispose();
    }

    // -------- Types --------

    private const uint EndAckSeq = 0xFFFFFFFFu;

    private enum OtaStatus : byte
    {
        Ok = 0, Retry = 1, OutOfOrder = 2, StaleSession = 3, Abort = 4,
        SizeMismatch = 5, Md5Mismatch = 6, UpdateFailed = 7, NoSession = 8,
    }

    private struct InFlight { public long SentAtMs; public int Retries; }

    private sealed class Session
    {
        public string DeviceName { get; }
        public string DeviceId { get; }
        public byte[] Firmware { get; }
        public uint SessionId { get; }
        public string Md5Hex { get; }
        public CancellationTokenSource Cts { get; } = new();
        public AckChannel AckChannel { get; } = new();
        public int TotalChunks;

        // Optional inline progress callback — fires on every percentage
        // advance in addition to the WS broadcast. Used when the caller
        // wants progress to flow through its own channel (e.g. the pendant
        // firmware SSE endpoint bridges wireless progress back into the
        // same event stream the USB flow uses).
        public Action<int>? OnProgress;

        public Session(string deviceName, byte[] firmware, string deviceId)
        {
            DeviceName = deviceName;
            DeviceId = deviceId;
            Firmware = firmware;
            SessionId = (uint)(new Random().Next(1, int.MaxValue));
            using var md5 = MD5.Create();
            Md5Hex = Convert.ToHexString(md5.ComputeHash(firmware)).ToLowerInvariant();
        }

        public void Abort(string reason) => Cts.Cancel();
    }

    // Cheap single-consumer ack queue. Producer pushes from the dongle recv
    // callback (any thread); consumer awaits from the flash task.
    private sealed class AckChannel
    {
        private readonly SemaphoreSlim _sem = new(0);
        private readonly ConcurrentQueue<(uint seq, OtaStatus status)> _q = new();

        public void Push((uint seq, OtaStatus status) ack)
        {
            _q.Enqueue(ack);
            _sem.Release();
        }

        public async Task<(uint seq, OtaStatus status)?> WaitAsync(int timeoutMs, CancellationToken ct)
        {
            if (await _sem.WaitAsync(timeoutMs, ct))
                return _q.TryDequeue(out var v) ? v : null;
            return null;
        }
    }
}
