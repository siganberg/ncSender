using System.Collections.Concurrent;
using System.IO.Ports;
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
    /// <summary>
    /// Device name that means "the Wireless USB itself". Matches the product id
    /// so the same string works from the API, and is deliberately not a peer
    /// name — the dongle never appears in its own $DEVICES list.
    /// </summary>
    public const string SelfDeviceName = "wireless-usb";

    // Chunk sizing: 200 B data + 10 B header = 210 B, well under the 246 B
    // ESP-NOW payload cap (leaves room for future header growth). 766 KB
    // firmware = ~3830 chunks.
    private const int ChunkSize = 200;
    // 4 chunks in flight matches the design decision; increase if bandwidth
    // is left on the table but watch for out-of-order thrash first.
    // ONE chunk in flight, deliberately. A deeper window overruns the dongle:
    // it relays every chunk to ESP-NOW as it arrives over USB, and at 4 (and
    // even at 2) the sustained load starved interrupts long enough to trip the
    // ESP32-S3 interrupt watchdog — the dongle silently reset mid-transfer and
    // the host just saw "No ACK for chunk N". Measured on an 821 KB payload:
    // window 4 died at ~chunk 300-770, window 2 at ~chunk 41, window 1 completed
    // in 51s. Raise this only with a dongle-side fix and a full-size test flash.
    private const int WindowSize = 1;
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
    private readonly INcSenderUsbCatalog _usbCatalog;
    private readonly XProbeRouter _xprobe;
    private readonly IBroadcaster _broadcaster;
    private readonly ConcurrentDictionary<string, Session> _sessions
        = new(StringComparer.OrdinalIgnoreCase);
    private readonly HttpClient _http = new();

    public DongleOtaService(
        ILogger<DongleOtaService> logger,
        IDongleDeviceService dongle,
        INcSenderUsbCatalog usbCatalog,
        XProbeRouter xprobe,
        IBroadcaster broadcaster)
    {
        _logger = logger;
        _dongle = dongle;
        _usbCatalog = usbCatalog;
        _xprobe = xprobe;
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
            // Log start/finish, not just failures. Without these the log goes
            // silent mid-transfer and a stall is indistinguishable from success.
            var startedMs = NowMs();
            // Make the updater the device's only owner for the duration. The
            // XProbe router otherwise holds the cable, which both blocked the
            // wired path and let a wireless flash compete with live USB traffic
            // — that combination reset the dongle mid-transfer.
            using var _hold = string.Equals(deviceName, "xprobe", StringComparison.OrdinalIgnoreCase)
                ? _xprobe.SuspendForFlash()
                : null;
            var viaUsb = TryAttachUsb(s);
            _logger.LogInformation("[OTA {Name}] start — {Bytes} bytes over {Transport}",
                deviceName, firmware.Length, viaUsb ? "USB" : "wireless");
            await FlashInternalAsync(s, ct);
            _logger.LogInformation("[OTA {Name}] COMPLETE in {Secs:F1}s",
                deviceName, (NowMs() - startedMs) / 1000.0);
            await BroadcastDoneAsync(s);
        }
        catch (OperationCanceledException)
        {
            await BroadcastErrorAsync(s, "Wireless firmware update was cancelled");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Firmware update failed for '{Name}'", deviceName);
            await BroadcastErrorAsync(s, ex.Message);
            throw;
        }
        finally
        {
            // Never hold the accessory's port past the flash — the scanner and
            // XProbeRouter both want it back, and a device that reboots into new
            // firmware re-enumerates underneath us anyway.
            DetachUsb(s);
            _sessions.TryRemove(deviceName, out _);
        }
    }

    public async Task FlashFromUrlAsync(string deviceName, string downloadUrl, string? deviceId, CancellationToken ct)
    {
        // Server-side download bypasses browser CORS on GitHub Release assets —
        // same reason the USB flow has a /flash-from-url variant.
        // The URL goes to the log, not to the status line: it is a ~110-character
        // unbreakable token, and the dialog shows this message in a narrow card.
        _logger.LogInformation("Downloading {Device} firmware from {Url}", deviceName, downloadUrl);
        await BroadcastMessageAsync(deviceName, deviceId ?? deviceName, "info",
            "Downloading firmware…");
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

    // Accessory name -> the USB identity it advertises. Only devices whose
    // firmware carries a custom iProduct string can be found this way; anything
    // else simply falls through to the dongle.
    private static NcSenderUsbKind KindFor(string deviceName) => deviceName.ToLowerInvariant() switch
    {
        "xprobe"       => NcSenderUsbKind.XProbe,
        "autodustboot" => NcSenderUsbKind.AutoDustBoot,
        "rgbled"       => NcSenderUsbKind.RgbController,
        "pendant"      => NcSenderUsbKind.Pendant,
        _              => NcSenderUsbKind.Unknown,
    };

    // Prefer the cable. The device speaks the identical "$OTA:" protocol on its
    // own CDC, so this is the same flash over a faster, quieter pipe — it does
    // not touch the radio, and it keeps working when no dongle is present.
    // Any failure to claim the port is not an error: we just use the dongle.
    private bool TryAttachUsb(Session s)
    {
        // The dongle is not reachable as a separate cable — it is the cable.
        // Its own updates go out over the link the host already holds.
        if (s.IsSelf) return false;

        var kind = KindFor(s.DeviceName);
        if (kind == NcSenderUsbKind.Unknown) return false;

        string? port = null;
        try
        {
            foreach (var d in _usbCatalog.GetDevices())
                if (d.Kind == kind) { port = d.PortName; break; }
        }
        catch (Exception ex) { _logger.LogDebug(ex, "[OTA {Name}] USB catalog lookup failed", s.DeviceName); }
        if (port is null) return false;

        try
        {
            var sp = new SerialPort(port, 115200)
            {
                ReadTimeout = 500,
                WriteTimeout = 5000,
                DtrEnable = true,
                RtsEnable = false,
                NewLine = "\n",
            };
            sp.Open();
            s.UsbPort = sp;
            s.SendLine = line =>
            {
                sp.Write(line + "\n");
                return Task.CompletedTask;
            };
            _ = Task.Run(() => PumpUsbAcksAsync(s, sp));
            _logger.LogInformation("[OTA {Name}] using USB {Port} (wired preferred)", s.DeviceName, port);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogInformation("[OTA {Name}] USB {Port} unavailable ({Err}) — falling back to wireless",
                s.DeviceName, port, ex.Message);
            return false;
        }
    }

    // Reads "$OTA:ACK <session> <seq> <status>" off the cable and feeds the same
    // AckChannel the dongle path uses, so the sliding-window logic is shared.
    private void PumpUsbAcksAsync(Session s, SerialPort sp)
    {
        while (!s.Cts.IsCancellationRequested && sp.IsOpen)
        {
            string line;
            try { line = sp.ReadLine(); }
            catch (TimeoutException) { continue; }
            catch { break; }
            var t = line.Trim();
            if (!t.StartsWith("$OTA:ACK ", StringComparison.Ordinal)) continue;
            var parts = t["$OTA:ACK ".Length..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 3) continue;
            if (!uint.TryParse(parts[0], out var sess) || sess != s.SessionId) continue;
            if (!uint.TryParse(parts[1], out var seq)) continue;
            if (!byte.TryParse(parts[2], out var st)) continue;
            s.AckChannel.Push((seq, (OtaStatus)st));
        }
    }

    private static void DetachUsb(Session s)
    {
        var sp = s.UsbPort;
        s.UsbPort = null;
        s.SendLine = null;
        if (sp is null) return;
        try { if (sp.IsOpen) sp.Close(); } catch { }
        try { sp.Dispose(); } catch { }
    }

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
        // Name the transport that is actually being used. This said "wireless"
        // unconditionally, which is wrong the moment the cable is preferred and
        // actively misleading: it is the only signal anyone has for which path a
        // flash took, so a USB flash reported itself as a wireless one.
        var via = s.ViaUsb ? "USB" : "wireless";
        await BroadcastMessageAsync(s, "info", $"Starting {via} flash ({s.Firmware.Length / 1024.0:N1} KB)");
        var beginLine = $"$OTA:BEGIN{s.Tag} {s.SessionId} {s.Firmware.Length} {ChunkSize} {s.Md5Hex}";
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
                        // Roughly every 10% — enough to see where a stall lands
                        // without flooding a 3000-chunk transfer.
                        if (totalChunks > 0 && nextExpectedAck % Math.Max(1, totalChunks / 10) == 0)
                            _logger.LogInformation("[OTA {Name}] {Done}/{Total} chunks",
                                s.DeviceName, nextExpectedAck, totalChunks);

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
        await SendAsync(s, $"$OTA:END{s.Tag} {s.SessionId} {s.Firmware.Length} {s.Md5Hex}");
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
        await SendAsync(s, $"$OTA:CHUNK{s.Tag} {s.SessionId} {seq} {len} {b64}");
    }

    // OTA lines are dongle-parser commands ($OTA:BEGIN/CHUNK/END) — they
    // must arrive on USB verbatim, not wrapped in "@name". Use the raw
    // sender bypass rather than SendAsync (which would prepend @name).
    private Task SendAsync(Session s, string line)
        => s.SendLine is not null ? s.SendLine(line) : _dongle.SendRawLineAsync(line);

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

        // Transport for this flash. Null = relay through the dongle, where every
        // line is addressed "@name". A direct USB cable is point-to-point, so it
        // sends the same protocol WITHOUT the tag and reads ACKs off the port.
        public Func<string, Task>? SendLine;
        public SerialPort? UsbPort;
        public bool ViaUsb => SendLine is not null;

        /// <summary>The dongle updating itself, rather than relaying to a peer.</summary>
        public bool IsSelf => string.Equals(DeviceName, SelfDeviceName, StringComparison.OrdinalIgnoreCase);

        // No "@tag" when the line is not being relayed anywhere: a direct USB
        // cable is point-to-point, and the dongle updating itself is too. The
        // dongle firmware reads an untagged "$OTA:" as addressed to itself,
        // which is exactly what this produces.
        public string Tag => (ViaUsb || IsSelf) ? "" : " @" + DeviceName;

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
