# FluidNC support

FluidNC runs as grblHAL. `FluidNcProtocol` is grblHAL's handler with a few
overrides, and `FluidNcTranslator` (the same `IGcodeTranslator` hook classic
Grbl uses) changes what is sent and what is reported, so the rest of ncSender
and every plugin only deal with grblHAL. Anything FluidNC gets wrong or does
differently is fixed in the translator, not in core code or plugins.

Checked against FluidNC v4.0.3 on a bench board (USB and WiFi telnet).

## What FluidNC already runs as grblHAL does

Sent unchanged: expressions (`X[a+b]`), named and numbered parameters
(`#<_metric>`, `#<_absolute>`, `#5220`, `#5063`, `#5399`, `#<_speed_override>`
reads 0), o-word `IF`/`ELSE`/`ENDIF`, `G43.1`/`G49`, `G10 L2/L20`, `G38.x`,
`M62`-`M66` (needs the pins configured in config.yaml), `$#`, `$G`, `$I`, `$$`
(grbl-style `$13`, `$20`-`$23`, `$100`-`$132`), `$H`, `$X`, `$J=`, realtime
`?`, `!`, `~`, `0x18`.

## Sent: translated

| grblHAL line | On FluidNC |
|---|---|
| `M51 P...` (override control) | Dropped. Tool changes run at the override the operator set. |
| `G65 P6` (skip at-speed wait) | Dropped: FluidNC has no wait to skip. Other `G65` macros fail with a reason. |
| `X-[expr]` | `X[-[expr]]` (FluidNC rejects a minus straight before a bracket). |
| `$EA` | `$A`; its `N: text` lines come back as `[ALARMCODE:N\|\|text]`. |
| `$EE`, `$EG`, `$ES`, `$ESH`, `$pinstate` | Answered without the controller (nothing to list). |
| `$#=_tool_offset` | `$#`, answered as `[PARAM:_TOOL_OFFSET=0\|1]` from its `[TLO:]`. |
| `$#=5063`, `$#=_name` | `(PRINT, ...)`, answered as `[PARAM:5063=...]`. |

## Reported: translated

| FluidNC report | As grblHAL |
|---|---|
| Status without `H:` | `H:1` added (no homed flag; homing is up to the operator). |
| `FS:feed,speed` | `FS:feed,speed,measured`, measured from the VFD's `[MSG:INFO: Current speed is N]`, drained to 0 after M5. |
| `[MSG:INFO: Current speed is N]`, `Syncing to`, `Synced speed to` | Dropped (folded into FS). |
| `[MSG:INFO: MSG, text]` (a `(MSG, ...)` comment) | `[MSG:text]`, so tool change sentinels, plugin dialogs and `NCSENDER_PAUSE` work. |
| `Ln:` after a reset | Hidden until a new line runs (FluidNC keeps the last run's number). |
| `WCO:` | FluidNC's own, sent every few reports (core keeps the last one). |

## Tool and tool length offset across a reset

FluidNC's `[TLO:]` is the offset last set with `G43.1` (or cleared with
`G49`), and a reset doesn't change it. FluidNC itself stops applying it at a
reset, though: its WCO goes without it. ncSender resets the controller every
time it connects, so without this a measured tool was unmeasured after every
reconnect, and before the translator the tool setter ran at every job start.

After any reset the translator reads `$G` (units) and `$#` before the next
line, and sends `G43.1 Z<offset>` if `[TLO:]` isn't 0, which is what grblHAL
keeps through a reset. Until FluidNC's WCO has it again, the reported WCO
carries it, so the DRO doesn't jump. Not into an alarm (it waits for it to
clear) and not on coolant/aux lines (they skip the queue).

A reset also sets FluidNC's tool to T0 (grblHAL keeps it). The translator
keeps the tool in `fluidnc-tool.txt` (user data folder) and sends
`M61 Q<tool>` after a reset that left T0, then `$G` so ncSender reads it.

## Handler (`FluidNcProtocol`)

What a translator can't change stays on the handler:

- Greeting: `Grbl ... [FluidNC ... '$' for help]`, not the earlier banner.
- No `0x87` full status request; no `$EE` error list (standard Grbl table).
- `SupportsSettingEnumeration` false (settings are a config.yaml tree): the
  Firmware tab stays hidden. `SupportsConfigFile` true: the Config tab.
- Axes from the number of MPos fields (no `[AXS:]`).
- `$G` after anything that changes the workspace or tool (no `WCS:`/`T:` in
  the status report): `G54`-`G59`, `M2`, `M30`, `M6`, `M61`, `T` words; not
  inside comments.

## Known gaps

- Commands are upper-cased before they are sent, so mixed-case FluidNC paths
  (`$LocalFS/Show=config.yaml`) fail through ncSender. The Config tab uses the
  board's HTTP API instead (WiFi/Ethernet only).
- `[AUX IO:]` isn't reported: plugins that list aux pins show none.
- Firmware `$` settings plugins read (`$31` minimum RPM, `$130`-`$132` travel)
  come from `$$` only where FluidNC lists them; `$31` isn't.
- `M66`/`#5399` work only with `digitalN_pin` configured; there is no grblHAL
  aux numbering to translate from.
- After an alarm that needs a reset (soft limit), lines already in FluidNC's
  buffer get no reply; the reset clears ncSender's queue.
- Over WiFi telnet a job streams at roughly 30 lines/s: ncSender sends a line
  and waits for its ok (all controllers), so the round trip sets the pace.
  USB streams short segments at full speed.
