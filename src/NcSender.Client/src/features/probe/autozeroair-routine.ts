/*
 * The AutoZeroAir probe's moves, for the picture in the probe dialog. It
 * follows the routine the server sends (NcZeroAirStrategy.cs): keep the two
 * in step when either changes.
 *
 * Frame: the material's corner is the origin with the material toward +X +Y
 * (a front-left corner), Z up from the material's top. The hole's centre is
 * then at (20, 20). Millimetres.
 */
export type AzaAxis = 'XYZ' | 'XY' | 'Z' | 'X' | 'Y';
export type AzaMode = 'hole' | 'edge';

export interface AzaPoint {
  p: [number, number, number];
  /** Which step this move belongs to. */
  step: number;
  /** A touch: the surface's normal, toward the tool. */
  n?: [number, number, number];
}
export interface AzaStep { key: string; sets: string }
export interface AzaRoutine { points: AzaPoint[]; steps: AzaStep[]; lead: string; start: string; end: string }

export const AZA = { hole: 15, top: 25, floor: 5, centre: 20, side: 10 } as const;

export function buildAutoZeroAirRoutine(axis: AzaAxis, mode: AzaMode, bit: number): AzaRoutine {
  const r = bit / 2;
  const c = AZA.centre;
  const points: AzaPoint[] = [];
  const steps: AzaStep[] = [];
  let step = 0;
  const begin = (key: string, sets: string) => { steps.push({ key, sets }); step = steps.length - 1; };
  const go = (x: number, y: number, z: number) => points.push({ p: [x, y, z], step });
  const touch = (x: number, y: number, z: number, n: [number, number, number]) => points.push({ p: [x, y, z], step, n });

  if (axis === 'Z') {
    if (mode === 'hole') {
      // On the floor of the hole, then out above the top.
      begin('floor', 'Z');
      go(c + 3, c - 2, 42); touch(c + 3, c - 2, AZA.floor, [0, 0, 1]); go(c + 3, c - 2, AZA.top + 3);
      return { points, steps, lead: 'zHole', start: 'holeXyz', end: 'z' };
    }
    // On the top face by the corner mark: over the material's corner, clear of
    // the hole and of the logo at the far corner.
    begin('top', 'Z');
    go(1, 1, 42); touch(1, 1, AZA.top, [0, 0, 1]); go(1, 1, AZA.top + 3);
    return { points, steps, lead: 'zTop', start: 'zTop', end: 'z' };
  }

  if (mode === 'hole') {
    // Started a little off centre, as a hand-placed tool is.
    const w = AZA.hole - r, ox = 3, oy = -2;
    let z = 12;
    if (axis === 'XYZ') {
      begin('floor', 'Z');
      go(c + ox, c + oy, 42); touch(c + ox, c + oy, AZA.floor, [0, 0, 1]);
      z = AZA.floor + 3;
      go(c + ox, c + oy, z);
    }
    let x = c + ox;
    if (axis !== 'Y') {
      begin('wallX', 'X');
      if (!points.length) go(x, c + oy, z);
      const chord = Math.sqrt(w * w - oy * oy);
      touch(c + chord, c + oy, z, [-1, 0, 0]); touch(c - chord, c + oy, z, [1, 0, 0]);
      x = c;
      go(x, c + oy, z);
    }
    if (axis !== 'X') {
      begin('wallY', 'Y');
      if (!points.length) go(x, c + oy, z);
      const chord = Math.sqrt(w * w - (x - c) * (x - c));
      touch(x, c + chord, z, [0, -1, 0]); touch(x, c - chord, z, [0, 1, 0]);
      go(x, c, z);
    }
    if (axis === 'XYZ') {
      begin('lift', 'X0 Y0');
      go(c, c, AZA.top + 3); go(0, 0, AZA.top + 3);
    }
    return { points, steps, lead: 'hole', start: axis === 'XYZ' ? 'holeXyz' : 'hole', end: axis === 'XYZ' ? 'holeXyz' : 'hole' };
  }

  // Outside faces: a standard block, 10 mm sides and a 25 mm top.
  const face = -AZA.side - r, out = -AZA.side - bit - 5, low = AZA.top - 5;
  if (axis === 'XYZ') {
    begin('top', 'Z');
    go(0, 0, 42); touch(0, 0, AZA.top, [0, 0, 1]); go(0, 0, AZA.top + 4);
    begin('edgeX', 'X');
    go(out, 0, AZA.top + 4); go(out, 0, low); touch(face, 0, low, [-1, 0, 0]); go(face - 8, 0, low);
    begin('edgeY', 'Y');
    go(face - 8, out, low); go(4, out, low); touch(4, face, low, [0, -1, 0]); go(4, face - 4, low);
    begin('liftEdge', 'X0 Y0');
    go(4, face - 4, low + 10); go(0, 0, low + 10);
    return { points, steps, lead: 'edge', start: 'edgeXyz', end: 'edgeCorner' };
  }
  if (axis === 'XY') {
    begin('edgeX', 'X');
    go(out, out, low); go(out, 6, low); touch(face, 6, low, [-1, 0, 0]); go(face - 8, 6, low);
    begin('edgeY', 'Y');
    go(face - 8, out, low); go(6, out, low); touch(6, face, low, [0, -1, 0]); go(6, face - 4, low);
    begin('liftEdge', 'X0 Y0');
    go(6, face - 4, low + 10); go(0, 0, low + 10);
    return { points, steps, lead: 'edge', start: 'edge', end: 'edgeCorner' };
  }
  begin('edgeOnly', axis);
  if (axis === 'X') { go(out, c, low); touch(face, c, low, [-1, 0, 0]); go(face - 4, c, low); }
  else { go(c, out, low); touch(c, face, low, [0, -1, 0]); go(c, face - 4, low); }
  return { points, steps, lead: 'edge', start: 'edge', end: 'edgeSide' };
}

export type AzaCorner = 'BottomLeft' | 'BottomRight' | 'TopLeft' | 'TopRight';

/** The corner the probe sits on. A single axis is still probed from a corner:
 *  the probe's lip needs two edges to sit against. */
export function autoZeroAirCorner(axis: AzaAxis, corner: string | null, side: string | null): AzaCorner {
  if (axis === 'X') return side === 'Right' ? 'BottomRight' : 'BottomLeft';
  if (axis === 'Y') return side === 'Back' ? 'TopLeft' : 'BottomLeft';
  return (['BottomLeft', 'BottomRight', 'TopLeft', 'TopRight'] as const).find((k) => k === corner) ?? 'BottomLeft';
}
