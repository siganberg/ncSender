// Simple G-code time estimator using feed/rapid and acceleration (trapezoid)
// - Supports G0, G1, G2, G3 with modal feed and units (G20/G21)
// - Handles IJ and R arcs; assumes XY plane for arcs
// - Approximates rapids by longest-axis time with per-axis vmax/accel

type FirmwareSettings = Record<string, { id: number; value?: string } | undefined>;

function toNum(v: any, def = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : def;
}

function trapezoidTime(distance: number, vmax: number, accel: number): number {
  // distance mm, vmax mm/s, accel mm/s^2 => seconds
  if (distance <= 0) return 0;
  if (vmax <= 0 || accel <= 0) return distance / Math.max(vmax, 1e-6);
  const dCrit = (vmax * vmax) / accel;
  if (dCrit > distance) {
    // Triangular
    return 2 * Math.sqrt(distance / accel);
  }
  // Trapezoid
  return 2 * (vmax / accel) + (distance - dCrit) / vmax;
}

function angleDelta(startAngle: number, endAngle: number, clockwise: boolean): number {
  let delta = endAngle - startAngle;
  if (clockwise && delta > 0) delta -= 2 * Math.PI;
  else if (!clockwise && delta < 0) delta += 2 * Math.PI;
  return Math.abs(delta);
}

export function estimateFromGCodeAndSettings(content: string, firmware: { settings?: FirmwareSettings } | null | undefined) {
  if (!content) return { totalSeconds: 0, perLineSeconds: [], cumulativePerLine: [] };

  // Firmware speeds (mm/min) and accels (mm/s^2)
  const s = (firmware && firmware.settings) || {};
  const vx = toNum(s['110']?.value, 3000) / 60; // mm/s
  const vy = toNum(s['111']?.value, 3000) / 60;
  const vz = toNum(s['112']?.value, 1000) / 60;
  const ax = toNum(s['120']?.value, 200); // mm/s^2
  const ay = toNum(s['121']?.value, 200);
  const az = toNum(s['122']?.value, 50);

  // Parser state
  let unitsMM = true; // G21 default
  let xyzAbsolute = true; // G90 default
  let ijAbsolute = false; // G91.1 default false (IJ incremental)
  let feedMMmin = 0; // modal feed
  let pos = { x: 0, y: 0, z: 0 };
  let totalSec = 0;
  const perLine: number[] = new Array(lines.length).fill(0);

  const lines = content.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const noParen = raw.replace(/\([^)]*\)/g, '');
    const line = noParen.split(';')[0].trim().toUpperCase();
    if (!line) continue;

    const gCmd = line.match(/G(\d+(?:\.\d+)?)/);
    const fCmd = line.match(/F([-+]?\d*\.?\d+)/);
    const xM = line.match(/X([-+]?\d*\.?\d+)/);
    const yM = line.match(/Y([-+]?\d*\.?\d+)/);
    const zM = line.match(/Z([-+]?\d*\.?\d+)/);
    const iM = line.match(/I([-+]?\d*\.?\d+)/);
    const jM = line.match(/J([-+]?\d*\.?\d+)/);
    const rM = line.match(/R([-+]?\d*\.?\d+)/);

    if (gCmd) {
      const code = gCmd[1];
      if (code === '20') unitsMM = false;
      if (code === '21') unitsMM = true;
      if (code === '90') xyzAbsolute = true;
      if (code === '91') xyzAbsolute = false;
      if (code === '90.1') ijAbsolute = true;
      if (code === '91.1') ijAbsolute = false;
    }
    if (fCmd) {
      const rawF = parseFloat(fCmd[1]);
      feedMMmin = unitsMM ? rawF : rawF * 25.4;
    }

    const next = { ...pos };
    if (xM) next.x = xyzAbsolute ? parseFloat(xM[1]) : pos.x + parseFloat(xM[1]);
    if (yM) next.y = xyzAbsolute ? parseFloat(yM[1]) : pos.y + parseFloat(yM[1]);
    if (zM) next.z = xyzAbsolute ? parseFloat(zM[1]) : pos.z + parseFloat(zM[1]);

    // Movement? Use last modal G if not present
    const moveCode = gCmd ? gCmd[1] : undefined;
    const moveInt = moveCode ? parseInt(moveCode) : NaN;
    const hasMove = (next.x !== pos.x || next.y !== pos.y || next.z !== pos.z);
    if (!hasMove) continue;

    // Determine mode: Use explicit G0/G1/G2/G3 if present; else last modal isn't tracked here; assume G1 when feed available
    let mode: 'G0' | 'G1' | 'G2' | 'G3' = 'G1';
    if (!Number.isNaN(moveInt) && [0, 1, 2, 3].includes(moveInt)) {
      mode = `G${moveInt}` as any;
    } else if (feedMMmin <= 0) {
      mode = 'G0';
    }

    if (mode === 'G0') {
      // Rapid: time is the max per-axis trapezoid time
      const dx = Math.abs(next.x - pos.x);
      const dy = Math.abs(next.y - pos.y);
      const dz = Math.abs(next.z - pos.z);
      const tx = trapezoidTime(dx, vx, ax);
      const ty = trapezoidTime(dy, vy, ay);
      const tz = trapezoidTime(dz, vz, az);
      const dt = Math.max(tx, ty, tz);
      totalSec += dt;
      perLine[idx] += dt;
    } else if (mode === 'G1') {
      const L = Math.hypot(next.x - pos.x, next.y - pos.y, next.z - pos.z);
      const vmax = Math.max(1e-6, (feedMMmin || 0) / 60); // mm/s
      const a = Math.max(1e-3, Math.min(ax, ay, az));
      const dt = trapezoidTime(L, vmax, a);
      totalSec += dt;
      perLine[idx] += dt;
    } else if (mode === 'G2' || mode === 'G3') {
      // Arc length from IJ or R
      let arcLen = 0;
      const cw = mode === 'G2';
      const iVal = iM ? parseFloat(iM[1]) : 0;
      const jVal = jM ? parseFloat(jM[1]) : 0;
      if ((iM || jM) && (xM || yM)) {
        const cx = ijAbsolute ? iVal : pos.x + iVal;
        const cy = ijAbsolute ? jVal : pos.y + jVal;
        const r = Math.hypot(pos.x - cx, pos.y - cy);
        const a0 = Math.atan2(pos.y - cy, pos.x - cx);
        const a1 = Math.atan2(next.y - cy, next.x - cx);
        const dAng = angleDelta(a0, a1, cw);
        arcLen = r * dAng;
      } else if (rM && (xM || yM)) {
        // Approximate via radius and chord
        const R = Math.abs(parseFloat(rM[1]));
        const chord = Math.hypot(next.x - pos.x, next.y - pos.y);
        // Avoid domain errors
        const clamped = Math.max(-1, Math.min(1, 1 - (chord * chord) / (2 * R * R)));
        const halfAng = Math.acos(clamped);
        const dAng = 2 * halfAng; // short arc assumption
        arcLen = R * dAng;
      } else {
        // Fallback to linear distance if arc params missing
        arcLen = Math.hypot(next.x - pos.x, next.y - pos.y);
      }
      const vmax = Math.max(1e-6, (feedMMmin || 0) / 60);
      const a = Math.max(1e-3, Math.min(ax, ay));
      const dt = trapezoidTime(arcLen, vmax, a);
      totalSec += dt;
      perLine[idx] += dt;
      // Z interpolation contributes minimally for standard arcs; omit for simplicity
    }

    pos = next;
  }

  // Build cumulative per-line seconds
  const cumulative: number[] = new Array(perLine.length);
  let acc = 0;
  for (let i = 0; i < perLine.length; i++) {
    acc += perLine[i];
    cumulative[i] = acc;
  }
  return { totalSeconds: Math.max(0, Math.round(totalSec)), perLineSeconds: perLine, cumulativePerLine: cumulative };
}
