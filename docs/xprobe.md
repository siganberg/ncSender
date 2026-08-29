# XProbe (wireless / wired probe device)

## Status: enabled

`XProbeRouter` and `XProbeTranslator` both run as hosted services. The
router binds the wired XProbe over USB and hands probe hits to the
translator, which turns them into grblHAL realtime bytes. Wireless
XProbes reach the same translator through the dongle instead.

See `src/NcSender.Server/ServerBuilder.cs`.

## Why it used to be off

The router's scan loop opened **every unclaimed USB serial port** every
4 seconds and wrote `$ID\n` to it. That had three real-world costs:

1. **Reset other devices.** Opening a port with `DtrEnable=true` toggles
   DTR — on Arduinos and CH340-based adapters that pulses the target's
   reset line.
2. **Ports looked "in use" on Windows.** While the probe held a port open
   (even for the ~800 ms identify window) other apps could not open it.
   Users reported ncSender monopolising their serial ports.
3. **Corrupted pendant OTA.** Found on the kiosk while debugging USB
   firmware update: `$ID\n` bytes landed inside the OTA raw stream,
   either between chunks (V2 pendant reports `Bad header ($ID)`) or
   inside a chunk body (V1 pendant silently corrupts the flash and
   `Update.end()` reports an MD5 mismatch).

All three came from the same root cause: probing devices that were never
XProbes to begin with.

## What changed

- **Identity first, not `$ID` first.** Candidate ports are filtered
  through `INcSenderUsbCatalog`, so the router only opens a device whose
  USB descriptors identify it as an XProbe. Unrelated peripherals are
  never opened, never reset and never held.
- **The `xprobe.enabled` opt-in is gone.** It existed to protect users
  from the blind scan. With the scan no longer blind its only remaining
  effect was leaving a cabled XProbe silently unconnected — the setting
  is no longer read, and a plugged-in XProbe just works.
- **Flash hold.** `SuspendForFlash()` parks the router for the duration
  of a firmware push so it cannot open the port mid-OTA. This is what
  keeps cost 3 above from coming back through a different door.

## Related files

- `src/NcSender.Server/Dongle/XProbeRouter.cs` — port binding + arbiter
- `src/NcSender.Server/Dongle/XProbeTranslator.cs` — turns XProbe hits
  into grblHAL realtime bytes
- `src/NcSender.Server/Usb/NcSenderUsbCatalog.cs` — USB identity matching
- `src/NcSender.Server/ServerBuilder.cs` — service registration
