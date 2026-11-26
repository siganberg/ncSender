/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

// Analog stick jogging: a push starts one held jog in a straight line, at
// the stick's angle (in 15° steps) and at a speed set by how far it's
// pushed. Turning the stick well away or pushing clearly more or less
// stops that jog and starts a new straight one; letting go stops it.

import { getSettings } from '@/lib/settings-store.js';
import { useAppStore } from '@/composables/use-app-store';
import { parseGamepadBinding } from './gamepad-utils';
import { startContinuousVectorJogSession, type ContinuousJogSession } from './actions';
import { api } from '../jog/api';

export interface StickJogSettings {
  enabled: boolean;
  expo: number;
  deadZone: number;
  // Fastest X/Y jog with the stick pushed all the way, in mm/min (Z gets half).
  topSpeed: number;
}

export const DEFAULT_STICK_JOG_SETTINGS: StickJogSettings = {
  enabled: false,
  expo: 1,
  deadZone: 0.12,
  topSpeed: 3000
};

export const TOP_SPEED_MIN = 250;
export const TOP_SPEED_MAX = 15000;

export const ANGLE_STEP_DEG = 15;
// A new jog when the stick turns this far or its push changes this much,
// once the change has held for SETTLE_MS.
export const REAIM_ANGLE_DEG = 15;
export const REAIM_PUSH = 0.25;
export const SETTLE_MS = 80;
export const MIN_SPEED_FRACTION = 0.02;
const STOP_WAIT_MS = 5000;
const MIN_STOP_WAIT_MS = 250;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function readStickJogSettings(raw: any): StickJogSettings {
  const number = (value: any, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  return {
    enabled: raw?.enabled === true,
    expo: number(raw?.expo, DEFAULT_STICK_JOG_SETTINGS.expo, 0, 1),
    deadZone: number(raw?.deadZone, DEFAULT_STICK_JOG_SETTINGS.deadZone, 0, 0.5),
    topSpeed: number(raw?.topSpeed, DEFAULT_STICK_JOG_SETTINGS.topSpeed, TOP_SPEED_MIN, TOP_SPEED_MAX)
  };
}

export function getStickJogSettings(): StickJogSettings {
  return readStickJogSettings(getSettings()?.gamepadAnalog);
}

export function speedCurve(push: number, expo: number): number {
  const x = clamp(push, 0, 1);
  if (x === 0) return 0;
  const k = clamp(expo, 0, 1);
  return MIN_SPEED_FRACTION + (1 - MIN_SPEED_FRACTION) * (k * x * x * x + (1 - k) * x);
}

function deadZone(magnitude: number, zone: number): number {
  if (!Number.isFinite(magnitude) || magnitude <= zone) return 0;
  return Math.min(1, (magnitude - zone) / (1 - zone));
}

export const snapAngle = (deg: number) => {
  const snapped = Math.round(deg / ANGLE_STEP_DEG) * ANGLE_STEP_DEG;
  return ((snapped % 360) + 360) % 360;
};

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// What the stick asks for: an XY jog at an angle (0° = X+, 90° = Y+), or a
// Z jog up or down, with how far it's pushed. XY wins when both are pushed.
export type StickTarget =
  | { kind: 'xy'; angle: number; push: number }
  | { kind: 'z'; sign: 1 | -1; push: number };

export function stickTarget(stick: { x: number; y: number; z: number }, zone: number): StickTarget | null {
  const xyPush = deadZone(Math.hypot(stick.x, stick.y), zone);
  if (xyPush > 0) return { kind: 'xy', angle: (Math.atan2(stick.y, stick.x) * 180) / Math.PI, push: xyPush };
  const zPush = deadZone(Math.abs(stick.z), zone);
  if (zPush > 0) return { kind: 'z', sign: stick.z > 0 ? 1 : -1, push: zPush };
  return null;
}

export function needsReaim(current: StickTarget, next: StickTarget): boolean {
  if (current.kind !== next.kind) return true;
  if (current.kind === 'z' && next.kind === 'z' && current.sign !== next.sign) return true;
  if (current.kind === 'xy' && next.kind === 'xy' && angleBetween(current.angle, next.angle) >= REAIM_ANGLE_DEG) return true;
  return Math.abs(current.push - next.push) >= REAIM_PUSH;
}

export function jogVector(target: StickTarget, settings: StickJogSettings, xyTop: number):
  { x: number; y: number; z: number; feed: number } {
  const feed = speedCurve(target.push, settings.expo) * (target.kind === 'xy' ? xyTop : xyTop / 2);
  if (target.kind === 'z') return { x: 0, y: 0, z: target.sign, feed };
  const rad = (snapAngle(target.angle) * Math.PI) / 180;
  const tidy = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { x: tidy(Math.cos(rad)), y: tidy(Math.sin(rad)), z: 0, feed };
}

// The top speed in the jog command's units (inches per minute when imperial).
export function stickTopFeed(settings: StickJogSettings): number {
  return useAppStore().unitsPreference.value === 'imperial' ? settings.topSpeed / 25.4 : settings.topSpeed;
}

// Actions that bind a stick axis to a jog axis (pushed toward + when
// binding). When they're bound, the Jog X/Y/Z actions stay free for the
// D-pad's steps; when they aren't, the stick reads the Jog bindings.
export const STICK_ACTIONS: Record<'X' | 'Y' | 'Z', string> = {
  X: 'StickJogX',
  Y: 'StickJogY',
  Z: 'StickJogZ'
};

const STICK_AXES: Record<'X' | 'Y' | 'Z', { plus: string; minus: string }> = {
  X: { plus: 'JogXPlus', minus: 'JogXMinus' },
  Y: { plus: 'JogYPlus', minus: 'JogYMinus' },
  Z: { plus: 'JogZPlus', minus: 'JogZMinus' }
};

type AxisBinding = { index: number; sign: number };

function axisBinding(bindingStr: string | null | undefined): AxisBinding | null {
  const binding = parseGamepadBinding(bindingStr ?? '');
  return binding?.type === 'axis' ? { index: binding.index, sign: binding.direction === 'positive' ? 1 : -1 } : null;
}

function stickAxes(bindings: Record<string, string | null>): Record<'X' | 'Y' | 'Z', AxisBinding[]> {
  const read = (axis: 'X' | 'Y' | 'Z') => {
    const own = axisBinding(bindings[STICK_ACTIONS[axis]]);
    if (own) return [own];
    const { plus, minus } = STICK_AXES[axis];
    return [axisBinding(bindings[plus]), axisBinding(bindings[minus])].filter((b): b is AxisBinding => b !== null);
  };
  return { X: read('X'), Y: read('Y'), Z: read('Z') };
}

// Actions the stick drives while stick jogging is on: the Variable-Speed Stick
// actions, and any Jog action on an axis the stick reads. Their usual
// handling stands aside; a Jog action on a button (the D-pad) keeps it.
export function stickJogActions(bindings: Record<string, string | null>): Set<string> {
  const read = new Set(Object.values(stickAxes(bindings)).flat().map((b) => b.index));
  const actions = new Set<string>();
  for (const actionId of [...Object.values(STICK_ACTIONS), ...Object.values(STICK_AXES).flatMap((a) => [a.plus, a.minus])]) {
    const bound = axisBinding(bindings[actionId]);
    if (bound && read.has(bound.index)) actions.add(actionId);
  }
  return actions;
}

// Each jog axis from −1 to 1. An axis bound both ways (Axis 0+ and Axis 0−),
// or a Variable-Speed Stick action on a standard pad's stick (axes 0-3), reads
// across its whole travel; otherwise only its bound half, so a trigger
// resting at −1 stays still.
export function readStick(gamepad: Gamepad, bindings: Record<string, string | null>): { x: number; y: number; z: number } {
  const value = (bound: AxisBinding) => {
    const raw = gamepad.axes[bound.index];
    return Number.isFinite(raw) ? raw * bound.sign : 0;
  };
  const read = (axis: 'X' | 'Y' | 'Z') => {
    const own = axisBinding(bindings[STICK_ACTIONS[axis]]);
    const plus = axisBinding(bindings[STICK_AXES[axis].plus]);
    const minus = axisBinding(bindings[STICK_AXES[axis].minus]);
    // On another pad, its − too when the step jog's − is that axis's other
    // way (which the stick then takes over), so pushing − isn't dead.
    if (own) {
      const bothWays = minus && minus.index === own.index && minus.sign !== own.sign;
      return (gamepad.mapping === 'standard' && own.index <= 3) || bothWays ? value(own) : Math.max(0, value(own));
    }
    if (plus && minus && plus.index === minus.index && plus.sign !== minus.sign) return value(plus);
    return (plus ? Math.max(0, value(plus)) : 0) - (minus ? Math.max(0, value(minus)) : 0);
  };
  return { x: read('X'), y: read('Y'), z: read('Z') };
}

// After any stop but letting go, and at startup, the stick has to come back
// to center before it jogs again.
export class StickJogger {
  private session: ContinuousJogSession | null = null;
  private running: StickTarget | null = null;
  private busy = false;
  private pending: { since: number; target: StickTarget } | null = null;
  private waitForCenter = true;
  // The machine has reported this jog running: once it stops on its own
  // (a feed hold, an alarm, the end of its travel), so does the stick.
  private sawJog = false;
  // Bumped by every stop, so a start still in flight knows to undo itself.
  private generation = 0;
  // The server ending this jog itself (its heartbeat watchdog) needs the
  // stick back at center before the next.
  private offStopped = api.on('jog:stopped', (data: any) => {
    if (this.session && data?.jogId === this.session.jogId && data.reason) this.stop('server-stopped');
  });

  update(target: StickTarget | null, now: number, allowed: boolean, settings: StickJogSettings, machine: string): void {
    if (!target) {
      this.waitForCenter = false;
      this.pending = null;
      if (this.session || this.busy) this.stop('centered', false);
      return;
    }
    if (!allowed) {
      this.stop('not-allowed');
      return;
    }
    if (this.session && !this.busy) {
      if (machine === 'jog') this.sawJog = true;
      else if (this.sawJog) {
        this.stop('machine-stopped');
        return;
      }
    }
    if (this.waitForCenter || this.busy) return;
    if (this.running && !needsReaim(this.running, target)) {
      this.pending = null;
      return;
    }
    if (!this.pending || needsReaim(this.pending.target, target)) {
      this.pending = { since: now, target };
      return;
    }
    if (now - this.pending.since < SETTLE_MS) return;
    this.pending = null;
    void this.start(target, settings);
  }

  private async start(target: StickTarget, settings: StickJogSettings): Promise<void> {
    this.busy = true;
    const generation = this.generation;
    try {
      const previous = this.session;
      if (previous) {
        this.session = null;
        this.running = null;
        await previous.stop('reaim');
        const stopped = await waitForJogToEnd();
        if (generation !== this.generation) return;
        if (!stopped) {
          this.waitForCenter = true;
          return;
        }
      }
      const { x, y, z, feed } = jogVector(target, settings, stickTopFeed(settings));
      const session = await startContinuousVectorJogSession({ x, y, z }, feed);
      if (session && generation !== this.generation) {
        session.stop('stopped-while-starting');
        return;
      }
      if (!session) {
        this.waitForCenter = true;
        return;
      }
      this.session = session;
      this.running = target;
      this.sawJog = false;
    } finally {
      this.busy = false;
    }
  }

  stop(reason: string, waitForCenter = true): void {
    if (waitForCenter) this.waitForCenter = true;
    this.generation++;
    this.pending = null;
    this.running = null;
    this.sawJog = false;
    const session = this.session;
    this.session = null;
    session?.stop(reason);
  }

  dispose(): void {
    this.stop('dispose');
    this.offStopped();
  }
}

// After a jog cancel the machine slows to a stop; a jog sent before it
// gets there can be dropped with the cancelled one. The first
// MIN_STOP_WAIT_MS lets a status report arrive (the last one may still say
// Idle from before the jog started). False when it's still jogging after
// STOP_WAIT_MS.
function waitForJogToEnd(): Promise<boolean> {
  const store = useAppStore();
  const jogging = () => String(store.status.machineState || '').toLowerCase() === 'jog';
  return new Promise((resolve) => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - started;
      if (elapsed < MIN_STOP_WAIT_MS) return;
      const done = !jogging();
      if (done || elapsed > STOP_WAIT_MS) {
        clearInterval(timer);
        resolve(done);
      }
    }, 10);
  });
}
