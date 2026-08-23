# XProbe (wireless / wired probe device)

## Status: disabled

The XProbe integration is intentionally **not started** in the current
build. `XProbeRouter` and `XProbeTranslator` are registered as singletons
so anything that resolves `IXProbeSource` still works, but neither is
registered as an `IHostedService`, so nothing scans and nothing translates.

See `src/NcSender.Server/ServerBuilder.cs` — the two `AddHostedService`
lines for XProbe are commented out.

## Why it's off

`XProbeRouter`'s USB scan loop (`ProbeOnce` in
`src/NcSender.Server/Dongle/XProbeRouter.cs`) opens every unclaimed USB
serial port every 4 seconds and writes `$ID\n` to it. That has three
real-world costs:

1. **Resets other devices.** Opening a serial port with `DtrEnable=true`
   toggles DTR — on Arduinos and CH340-based USB-serial adapters that
   pulses the target's reset line.
2. **Ports look "in use" on Windows.** While the probe holds the port
   open (even for the ~800 ms identify window), other apps can't open
   it. Users have reported ncSender monopolising their serial ports.
3. **Corrupts pendant OTA.** Discovered on the kiosk while debugging
   the USB firmware update: `$ID\n` bytes landed inside the OTA raw
   stream, either between chunks (V2 pendant reports `Bad header ($ID)`)
   or inside a chunk body (V1 pendant silently corrupts the flash and
   `Update.end()` reports MD5 mismatch). The port-exclusion fix that
   went in alongside this disable keeps the pendant/dongle ports off
   the candidate list, but arbitrary third-party USB-serial devices
   are still probed and still vulnerable to the reset/lock behaviour.

## What has to change before re-enabling

1. **Never open unclaimed ports blindly.** The scanner should keep a
   persistent "seen once, not xprobe" cache keyed by USB vendor/product
   IDs so a device is probed *at most once* per plug event, not every
   4 s forever.
2. **Filter by VID/PID first, if possible.** If the xprobe device
   exposes a stable USB identity, restrict probing to matching ports
   only. This is far safer than sending `$ID` to anything that shows
   up as a USB-serial device.
3. **Add an opt-in setting.** `xprobe.enabled` in settings.json,
   defaulting to `false`. Users who own an xprobe device turn it on;
   nobody else pays the cost.
4. **DTR-safe open.** Only assert DTR/RTS after positively identifying
   the device — the initial open should leave both lines alone so a
   reset-on-DTR peripheral isn't kicked mid-life.

## How to re-enable temporarily (for development / bench testing)

Uncomment the two lines in `ServerBuilder.cs`:

```csharp
builder.Services.AddHostedService(sp => sp.GetRequiredService<NcSender.Server.Dongle.XProbeRouter>());
builder.Services.AddHostedService<NcSender.Server.Dongle.XProbeTranslator>();
```

Rebuild and restart. Do **not** ship this to users until the changes
above land.

## Related files

- `src/NcSender.Server/Dongle/XProbeRouter.cs` — the scanner + arbiter
- `src/NcSender.Server/Dongle/XProbeTranslator.cs` — turns xprobe hits
  into grblHAL realtime bytes
- `src/NcSender.Server/ServerBuilder.cs` — where re-enabling happens
