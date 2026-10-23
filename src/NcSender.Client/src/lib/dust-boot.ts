// AutoDustBoot auxiliary output.
//
// Once an AutoDustBoot is paired with the Wireless USB (device "autodustboot"),
// Auxiliary I/O gets one fixed output for it, "AutoDustBoot": on = expand,
// off = retract. It isn't stored in auxOutputs and can't be renamed, edited or
// removed; it is there while the boot is paired and gone when it isn't. The
// visualizer shows it as a quick toggle, so the boot can be moved without
// opening the plugin.
//
// The boot has no expand/retract command of its own: retract is "goto:0" and
// expand is "goto:<counts>" to the position saved on the boot, which it reports
// as expand=<counts> in every status line. The saved "on" command carries the
// placeholder "goto:expand"; dustBootCommand() fills in the counts when sent.
// The switch sends it straight to the boot (sendDustBoot), not through the
// controller's queue.

import { reactive } from 'vue';
import { api } from './api.js';

export const DUST_BOOT_DEVICE = 'autodustboot';
export const DUST_BOOT_OUTPUT_ID = 'autodustboot';
export const DUST_BOOT_NAME = 'AutoDustBoot';
export const DUST_BOOT_ON = `(DONGLE:${DUST_BOOT_DEVICE}:goto:expand)`;
export const DUST_BOOT_OFF = `(DONGLE:${DUST_BOOT_DEVICE}:goto:0)`;

// Within 0.3 mm of home counts as retracted, as in the plugin's dialog
// (505.7 counts per mm).
const RETRACTED_COUNTS = Math.round(0.3 * 505.7);

export const dustBoot = reactive({
  paired: false,
  /** Last reported position in counts, or null before the first status. */
  pos: null as number | null,
  /** Expand position saved on the boot, in counts (0 = none saved). */
  expand: 0,
  /** The boot's own state: home / expanded / moving / homing … */
  state: '' as string,
  /** What the switch shows. Follows the boot whenever it stops, wherever the
   *  move came from (this switch, the plugin, a job, the boot's buttons). */
  expanded: false,
});

// While the boot is moving its position says nothing about where it is going,
// so the switch keeps what it shows (the target, when the switch started it)
// until the boot reports it has stopped.
const IN_MOTION = new Set(['moving', 'homing']);

/** The fixed Auxiliary I/O row for the boot, shaped like an auxOutputs entry. */
export const dustBootOutput = () => ({
  id: DUST_BOOT_OUTPUT_ID,
  enabled: true,
  name: DUST_BOOT_NAME,
  on: DUST_BOOT_ON,
  holdToActivate: false,
  locked: true,
});

export const isDustBootCommand = (command: string | undefined | null): boolean =>
  command === DUST_BOOT_ON || command === DUST_BOOT_OFF;

/** The line actually sent for an on/off command: expand gets the saved counts. */
export function dustBootCommand(on: boolean): string | null {
  if (!on) return DUST_BOOT_OFF;
  return dustBoot.expand > 0 ? `(DONGLE:${DUST_BOOT_DEVICE}:goto:${dustBoot.expand})` : null;
}

/**
 * Send the switch's on/off straight to the boot over the Wireless USB. The
 * boot is not on the controller, so this doesn't wait behind queued G-code.
 * Returns false when expand has no saved position to go to.
 */
export async function sendDustBoot(on: boolean): Promise<boolean> {
  const command = dustBootCommand(on);
  if (!command) return false;
  const payload = command.slice(`(DONGLE:${DUST_BOOT_DEVICE}:`.length, -1);   // "goto:<counts>"
  const res = await fetch(`${api.baseUrl}/api/dongle/devices/${DUST_BOOT_DEVICE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) throw new Error(`AutoDustBoot send failed: ${res.status}`);
  return true;
}

/** Fields from a boot status line ("status pos=-3 expand=46524 state=home"). */
export function parseDustBootStatus(payload: string | undefined | null): { pos?: number; expand?: number; state?: string } {
  const out: { pos?: number; expand?: number; state?: string } = {};
  const text = payload || '';
  const pos = text.match(/\bpos=(-?\d+)/);
  const expand = text.match(/\b(?:expand|saved)=(-?\d+)/);
  const state = text.match(/\bstate=(\S+)/);
  if (pos) out.pos = Number(pos[1]);
  if (expand) out.expand = Number(expand[1]);
  if (state) out.state = state[1];
  return out;
}

const apply = (payload: string | undefined | null) => {
  const s = parseDustBootStatus(payload);
  if (s.pos !== undefined) dustBoot.pos = s.pos;
  if (s.expand !== undefined) dustBoot.expand = s.expand;
  if (s.state !== undefined) dustBoot.state = s.state;
  if (IN_MOTION.has(dustBoot.state)) { pendingUntil = 0; return; }
  // A status sent before the boot picked up the switch's command still says
  // where it was; don't let it flip the switch back.
  if (Date.now() < pendingUntil) return;
  if (dustBoot.pos !== null) dustBoot.expanded = dustBoot.pos > RETRACTED_COUNTS;
};

// After a flip, settled statuses are ignored until the boot reports it is
// moving, or for this long if it never does (already there, or no answer).
const PENDING_MS = 2500;
let pendingUntil = 0;

/** The switch was flipped: show the target until the boot reports where it stopped. */
export const setDustBootTarget = (expanded: boolean) => {
  dustBoot.expanded = expanded;
  pendingUntil = Date.now() + PENDING_MS;
};

export async function refreshDustBoot() {
  try {
    const res = await fetch(`${api.baseUrl}/api/dongle/devices`);
    if (!res.ok) return;
    const devices = await res.json();
    const device = Array.isArray(devices) ? devices.find((d: any) => d?.name === DUST_BOOT_DEVICE) : null;
    dustBoot.paired = !!device;
    if (device) apply(device.lastMessage);
    else dustBoot.pos = null;
  } catch {
    // Keep the last answer.
  }
}

let watching = false;
/** Start following the boot (pairing and position). Safe to call more than once. */
export function watchDustBoot() {
  if (watching) return;
  watching = true;
  refreshDustBoot();
  api.on('dongle:device-changed', refreshDustBoot);
  api.on('dongle:device-message', (msg: any) => {
    if (msg?.name === DUST_BOOT_DEVICE) apply(msg.payload);
  });
}
