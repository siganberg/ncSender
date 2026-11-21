/*
 * The Standard Block's moves, for the picture in the probe dialog. It follows
 * the routine the server sends (StandardBlockStrategy.cs): keep the two in
 * step when either changes. The picture shows the block as drawn, 10 mm sides
 * and a 15 mm top; the sizes typed in the dialog only shift the moves a little.
 *
 * Frame: the material's corner is the origin with the material toward +X +Y
 * (a front-left corner), Z up from the material's top. The block's centre is
 * then at (15, 15) and the circle on its top at (2, 2). Millimetres.
 */
export type SbAxis = 'XYZ' | 'XY' | 'Z' | 'X' | 'Y';

export interface SbPoint {
  p: [number, number, number];
  /** Which step this move belongs to. */
  step: number;
  /** A touch: the surface's normal, toward the tool. */
  n?: [number, number, number];
}
export interface SbStep { key: string; sets: string }
export interface SbRoutine { points: SbPoint[]; steps: SbStep[]; lead: string; start: string; end: string }

export const SB = { half: 25, top: 15, side: 10, centre: 15, mark: 2, depth: 3 } as const;

export function buildStandardBlockRoutine(axis: SbAxis, bit: number): SbRoutine {
  const r = bit / 2;
  const c = SB.centre, m = SB.mark;
  const points: SbPoint[] = [];
  const steps: SbStep[] = [];
  let step = 0;
  const begin = (key: string, sets: string) => { steps.push({ key, sets }); step = steps.length - 1; };
  const go = (x: number, y: number, z: number) => points.push({ p: [x, y, z], step });
  const touch = (x: number, y: number, z: number, n: [number, number, number]) => points.push({ p: [x, y, z], step, n });

  if (axis === 'Z') {
    begin('top', 'Z');
    // On the circle, as an XYZ probe starts.
    go(m, m, SB.top + 17); touch(m, m, SB.top, [0, 0, 1]); go(m, m, SB.top + 4);
    return { points, steps, lead: 'z', start: 'xyz', end: 'z' };
  }

  const face = -SB.side - r, out = -SB.side - bit - 5, low = SB.top - SB.depth;
  if (axis === 'XYZ') {
    begin('top', 'Z');
    go(m, m, SB.top + 17); touch(m, m, SB.top, [0, 0, 1]); go(m, m, SB.top + 4);
    begin('edgeX', 'X');
    go(out, m, SB.top + 4); go(out, m, low); touch(face, m, low, [-1, 0, 0]); go(face - 8, m, low);
    begin('edgeY', 'Y');
    go(face - 8, out, low); go(m + 4, out, low); touch(m + 4, face, low, [0, -1, 0]); go(m + 4, face - 4, low);
    begin('liftEdge', 'X0 Y0');
    go(m + 4, face - 4, low + 10); go(0, 0, low + 10);
    return { points, steps, lead: 'block', start: 'xyz', end: 'corner' };
  }
  if (axis === 'XY') {
    begin('edgeX', 'X');
    go(out, out, low); go(out, 6, low); touch(face, 6, low, [-1, 0, 0]); go(face - 8, 6, low);
    begin('edgeY', 'Y');
    go(face - 8, out, low); go(6, out, low); touch(6, face, low, [0, -1, 0]); go(6, face - 4, low);
    begin('liftEdge', 'X0 Y0');
    go(6, face - 4, low + 10); go(0, 0, low + 10);
    return { points, steps, lead: 'block', start: 'xy', end: 'corner' };
  }
  begin('edgeOnly', axis);
  if (axis === 'X') { go(out, c, low); touch(face, c, low, [-1, 0, 0]); go(face - 4, c, low); }
  else { go(c, out, low); touch(c, face, low, [0, -1, 0]); go(c, face - 4, low); }
  return { points, steps, lead: 'block', start: 'side', end: 'side' };
}

export type SbCorner = 'BottomLeft' | 'BottomRight' | 'TopLeft' | 'TopRight';

/** The corner the block sits on. A single axis is still probed from a corner:
 *  the block's lip needs two edges to sit against. */
export function standardBlockCorner(axis: SbAxis, corner: string | null, side: string | null): SbCorner {
  if (axis === 'X') return side === 'Right' ? 'BottomRight' : 'BottomLeft';
  if (axis === 'Y') return side === 'Back' ? 'TopLeft' : 'BottomLeft';
  return (['BottomLeft', 'BottomRight', 'TopLeft', 'TopRight'] as const).find((k) => k === corner) ?? 'BottomLeft';
}
