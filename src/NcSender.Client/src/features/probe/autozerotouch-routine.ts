/*
 * The AutoZero Touch plate's moves, for the picture in the probe dialog. It
 * follows the routine the server sends (AutoZeroTouchStrategy.cs): keep the
 * two in step when either changes.
 *
 * Frame: the material's corner is the origin with the material toward +X +Y
 * (a front-left corner), Z up from the material's top. The plate's 45 mm
 * pocket then runs from 0 to 45 on both axes, its centre at (22.5, 22.5), with
 * the touch pad there 5 mm up. Millimetres.
 */
export type AztAxis = 'XYZ' | 'XY' | 'Z' | 'X' | 'Y';

export interface AztPoint {
  p: [number, number, number];
  /** Which step this move belongs to. */
  step: number;
  /** A touch: the surface's normal, toward the tool. */
  n?: [number, number, number];
}
export interface AztStep { key: string; sets: string }
export interface AztRoutine { points: AztPoint[]; steps: AztStep[]; lead: string; start: string; end: string }

/** `near`/`far`: the plate's outer sides, from the material's corner. */
export const AZT = { pocket: 45, centre: 22.5, pad: 5, top: 25, near: -10, far: 68 } as const;

/**
 * @param both  Both walls are touched on each axis (Auto and Tip), which finds
 *              the middle whatever the bit. With a diameter given, one wall is.
 */
export function buildAutoZeroTouchRoutine(axis: AztAxis, bit: number, both: boolean): AztRoutine {
  const r = bit / 2;
  const c = AZT.centre;
  const points: AztPoint[] = [];
  const steps: AztStep[] = [];
  let step = 0;
  const begin = (key: string, sets: string) => { steps.push({ key, sets }); step = steps.length - 1; };
  const go = (x: number, y: number, z: number) => points.push({ p: [x, y, z], step });
  const touch = (x: number, y: number, z: number, n: [number, number, number]) => points.push({ p: [x, y, z], step, n });

  // Started a little off centre, as a hand-placed tool is.
  const ox = 2, oy = -1.5;
  const lead = both ? 'both' : 'one';
  if (axis === 'Z') {
    begin('pad', 'Z');
    go(c + ox, c + oy, AZT.top + 15); touch(c + ox, c + oy, AZT.pad, [0, 0, 1]); go(c + ox, c + oy, AZT.pad + 5);
    return { points, steps, lead: 'z', start: 'above', end: 'z' };
  }

  const z = AZT.pad + 5;
  if (axis === 'XYZ') {
    begin('pad', 'Z');
    go(c + ox, c + oy, AZT.top + 15); touch(c + ox, c + oy, AZT.pad, [0, 0, 1]); go(c + ox, c + oy, z);
  }
  let x = c + ox;
  if (axis !== 'Y') {
    begin(both ? 'wallsX' : 'wallX', 'X');
    if (!points.length) go(x, c + oy, z);
    touch(AZT.pocket - r, c + oy, z, [-1, 0, 0]);
    if (both) touch(r, c + oy, z, [1, 0, 0]);
    x = c;
    go(x, c + oy, z);
  }
  if (axis !== 'X') {
    begin(both ? 'wallsY' : 'wallY', 'Y');
    if (!points.length) go(x, c + oy, z);
    touch(x, AZT.pocket - r, z, [0, -1, 0]);
    if (both) touch(x, r, z, [0, 1, 0]);
    go(x, c, z);
  }
  if (axis === 'XYZ') {
    // Out through the open corner, then down onto the material.
    begin('corner', 'X0 Y0');
    go(0, 0, z); go(0, 0, 0);
    return { points, steps, lead, start: 'above', end: 'xyz' };
  }
  if (axis === 'XY') {
    begin('cornerXY', 'X0 Y0');
    go(0, 0, z);
    return { points, steps, lead, start: 'inside', end: 'xy' };
  }
  return { points, steps, lead, start: 'inside', end: 'side' };
}

export type AztCorner = 'BottomLeft' | 'BottomRight' | 'TopLeft' | 'TopRight';

/** The corner the plate sits on. A single axis is still probed from a corner:
 *  the plate's lips need two edges to sit against. */
export function autoZeroTouchCorner(axis: AztAxis, corner: string | null, side: string | null): AztCorner {
  if (axis === 'X') return side === 'Right' ? 'BottomRight' : 'BottomLeft';
  if (axis === 'Y') return side === 'Back' ? 'TopLeft' : 'BottomLeft';
  return (['BottomLeft', 'BottomRight', 'TopLeft', 'TopRight'] as const).find((k) => k === corner) ?? 'BottomLeft';
}
