// Basic ETA estimator for G-code using machine limits
// Assumptions: absolute positioning (G90), mm units (G21), feed in mm/min, accel in mm/s^2

export interface FirmwareLike {
  settings?: Record<string, { value?: string | number }>;
}

export interface EtaResult {
  seconds: number;
}

function getNumber(setting: any, def: number): number {
  const v = setting?.value ?? setting;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function estimateEtaSeconds(gcode: string, firmware?: FirmwareLike): EtaResult {
  // Defaults if firmware is missing
  const maxX = getNumber(firmware?.settings?.['110'], 3000); // mm/min
  const maxY = getNumber(firmware?.settings?.['111'], 3000); // mm/min
  const maxZ = getNumber(firmware?.settings?.['112'], 800);  // mm/min
  const accX = getNumber(firmware?.settings?.['120'], 200);  // mm/s^2
  const accY = getNumber(firmware?.settings?.['121'], 200);  // mm/s^2
  const accZ = getNumber(firmware?.settings?.['122'], 80);   // mm/s^2

  const vRapidXY = Math.min(maxX, maxY) / 60; // mm/s
  const vRapidZ = maxZ / 60; // mm/s
  const aXY = Math.min(accX, accY); // mm/s^2
  const aZ = accZ; // mm/s^2

  let x = 0, y = 0, z = 0;
  let feedMmPerMin = 1000; // default feed
  let currentPlane = 'G17'; // XY plane

  let totalSec = 0;

  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const clean = raw.split(';')[0].trim().toUpperCase();
    if (!clean) continue;

    const gMatch = clean.match(/G(\d+(?:\.\d+)?)/);
    const fMatch = clean.match(/F([-+]?\d*\.?\d+)/);
    const xMatch = clean.match(/X([-+]?\d*\.?\d+)/);
    const yMatch = clean.match(/Y([-+]?\d*\.?\d+)/);
    const zMatch = clean.match(/Z([-+]?\d*\.?\d+)/);
    const iMatch = clean.match(/I([-+]?\d*\.?\d+)/);
    const jMatch = clean.match(/J([-+]?\d*\.?\d+)/);

    if (clean.includes('G17')) currentPlane = 'G17';
    if (clean.includes('G18')) currentPlane = 'G18';
    if (clean.includes('G19')) currentPlane = 'G19';

    if (fMatch) {
      feedMmPerMin = Number(fMatch[1]);
    }

    const prev = { x, y, z };
    if (xMatch) x = Number(xMatch[1]);
    if (yMatch) y = Number(yMatch[1]);
    if (zMatch) z = Number(zMatch[1]);

    if (!gMatch) continue;
    const gCode = parseInt(gMatch[1]);

    const dx = x - prev.x;
    const dy = y - prev.y;
    const dz = z - prev.z;

    let dist = 0;
    if (gCode === 2 || gCode === 3) {
      // Arc length in active plane (approximate)
      const iVal = iMatch ? Number(iMatch[1]) : 0;
      const jVal = jMatch ? Number(jMatch[1]) : 0;
      if (currentPlane === 'G17') {
        const cx = prev.x + iVal;
        const cy = prev.y + jVal;
        const r = Math.hypot(prev.x - cx, prev.y - cy);
        const ang1 = Math.atan2(prev.y - cy, prev.x - cx);
        const ang2 = Math.atan2(y - cy, x - cx);
        let dAng = ang2 - ang1;
        if (gCode === 2 && dAng > 0) dAng -= 2 * Math.PI; // CW
        if (gCode === 3 && dAng < 0) dAng += 2 * Math.PI; // CCW
        dist = Math.abs(r * dAng);
      } else {
        // Fallback: chord length
        dist = Math.hypot(dx, dy, dz);
      }
    } else if (gCode === 0 || gCode === 1) {
      dist = Math.hypot(dx, dy, dz);
    }

    if (dist <= 0) continue;

    const isRapid = gCode === 0;
    const vTarget = (isRapid ? (Math.abs(dz) > Math.hypot(dx, dy) ? vRapidZ : vRapidXY) : (Math.max(1, feedMmPerMin) / 60));
    const a = (Math.abs(dz) > Math.hypot(dx, dy)) ? aZ : aXY;

    // Trapezoidal motion profile time
    const dAcc = (vTarget * vTarget) / a; // distance to accel+decel combined
    let t;
    if (dist > dAcc) {
      t = (2 * vTarget / a) + ((dist - dAcc) / vTarget);
    } else {
      t = 2 * Math.sqrt(dist / a);
    }
    totalSec += t;
  }

  return { seconds: totalSec };
}

