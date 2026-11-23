/*
 * The 3D probe's moves, for the picture in the probe dialog. It follows the
 * routines the server sends (ThreeDProbeStrategy.cs), with round sizes: keep
 * the two in step when either changes.
 *
 * Positions are the ball's centre, in millimetres, Z up from the top of the
 * material. Corner and side probes: the corner (or the edge) is the origin and
 * the material lies toward +X +Y. Center probes: the origin is the middle of
 * the hole or the part.
 */
export type P3dAxis = 'XYZ' | 'XY' | 'Z' | 'X' | 'Y' | 'Center - Inner' | 'Center - Outer';
export type P3dScene = 'corner' | 'sideX' | 'sideY' | 'hole' | 'part';

export interface P3dPoint { p: [number, number, number]; step: number; n?: [number, number, number] }
export interface P3dStep { key: string; sets: string }
export interface P3dRoutine { scene: P3dScene; points: P3dPoint[]; steps: P3dStep[]; start: string; end: string }

/** The picture's sizes: the ball's radius, how far below the top the sides are
 *  touched, half the hole or part a Center probe is shown on, and the radius
 *  of the round one it is shown on in turn. */
export const P3D = { ball: 1, depth: 5, park: 4, halfX: 30, halfY: 22, radius: 26 } as const;

/** `round` shows a Center probe on a round hole or part instead of a square one. */
export function buildProbe3dRoutine(axis: P3dAxis, centerAxes = 'XY', probeZFirst = false, round = false): P3dRoutine {
  const r = P3D.ball, low = -P3D.depth;
  // Half the width met along X at this Y, and along Y at this X: on a round
  // one, off the middle, that is a shorter chord.
  const chord = (off: number) => Math.sqrt(P3D.radius * P3D.radius - off * off);
  const halfX = (y: number) => (round ? chord(y) : P3D.halfX);
  const halfY = (x: number) => (round ? chord(x) : P3D.halfY);
  const points: P3dPoint[] = [];
  const steps: P3dStep[] = [];
  let step = 0;
  const begin = (key: string, sets: string) => { steps.push({ key, sets }); step = steps.length - 1; };
  const go = (x: number, y: number, z: number) => points.push({ p: [x, y, z], step });
  const touch = (x: number, y: number, z: number, n: [number, number, number]) => points.push({ p: [x, y, z], step, n });
  const done = (scene: P3dScene, start: string, end: string): P3dRoutine => ({ scene, points, steps, start, end });

  if (axis === 'Z') {
    begin('top', 'Z');
    go(24, 20, 18); touch(24, 20, r, [0, 0, 1]); go(24, 20, r + P3D.park);
    return done('corner', 'z', 'z');
  }
  if (axis === 'X') {
    begin('sideOnly', 'X');
    go(-12, 0, low); touch(-r, 0, low, [-1, 0, 0]); go(-r - 4, 0, low);
    return done('sideX', 'side', 'side');
  }
  if (axis === 'Y') {
    begin('sideOnly', 'Y');
    go(0, -12, low); touch(0, -r, low, [0, -1, 0]); go(0, -r - 4, low);
    return done('sideY', 'side', 'side');
  }
  if (axis === 'XY' || axis === 'XYZ') {
    let y = 6;
    if (axis === 'XYZ') {
      y = 10;
      begin('top', 'Z');
      go(10, y, 16); touch(10, y, r, [0, 0, 1]); go(10, y, r + P3D.park);
      begin('sideX', 'X');
      go(-8, y, r + P3D.park); go(-8, y, low);
    } else {
      begin('sideX', 'X');
      go(-8, -8, low); go(-12, -12, low); go(-12, y, low);
    }
    touch(-r, y, low, [-1, 0, 0]); go(-r - 4, y, low);
    begin('sideY', 'Y');
    go(-13, y, low); go(-13, -14, low); go(5, -14, low);
    touch(5, -r, low, [0, -1, 0]); go(5, -r - 4, low);
    begin('lift', 'X0 Y0');
    go(5, -r - 4, 5); go(0, 0, 5);
    return done('corner', axis === 'XYZ' ? 'xyz' : 'xy', 'corner');
  }

  const doX = centerAxes !== 'Y', doY = centerAxes !== 'X';
  const sets = doX && doY ? 'X0 Y0' : doX ? 'X0' : 'Y0';
  if (axis === 'Center - Inner') {
    // Started a little off the middle, as a hand-placed probe is.
    let x = 5, y = -4;
    const high = 6;
    begin(doX ? 'wallsX' : 'wallsY', doX ? 'X' : 'Y');
    go(x, y, high); go(x, y, low);
    if (doX) {
      const hx = halfX(y);
      touch(-(hx - r), y, low, [1, 0, 0]); touch(hx - r, y, low, [-1, 0, 0]);
      x = 0; go(x, y, low);
      if (doY) begin('wallsY', 'Y');
    }
    if (doY) {
      const hy = halfY(x);
      touch(x, -(hy - r), low, [0, 1, 0]); touch(x, hy - r, low, [0, -1, 0]);
      y = 0; go(x, y, low);
    }
    begin('liftOut', sets);
    go(x, y, high);
    return done('hole', 'inner', 'inner');
  }

  // Center - Outer: down outside each side, touch inward, back over the top.
  let x = 4, y = -3;
  let high = 8;
  if (probeZFirst) {
    begin('top', 'Z');
    go(x, y, 16); touch(x, y, r, [0, 0, 1]);
    high = r + P3D.park;
    go(x, y, high);
  }
  const out = 8;
  if (doX) {
    begin('sidesX', 'X');
    if (!points.length) go(x, y, high);
    const hx = halfX(y);
    go(-(hx + out), y, high); go(-(hx + out), y, low); touch(-(hx + r), y, low, [-1, 0, 0]);
    go(-(hx + r + 2), y, low); go(-(hx + r + 2), y, high);
    go(hx + out, y, high); go(hx + out, y, low); touch(hx + r, y, low, [1, 0, 0]);
    go(hx + r + 2, y, low); go(hx + r + 2, y, high);
    x = 0; go(x, y, high);
  }
  if (doY) {
    begin('sidesY', 'Y');
    if (!points.length) go(x, y, high);
    const hy = halfY(x);
    go(x, -(hy + out), high); go(x, -(hy + out), low); touch(x, -(hy + r), low, [0, -1, 0]);
    go(x, -(hy + r + 2), low); go(x, -(hy + r + 2), high);
    go(x, hy + out, high); go(x, hy + out, low); touch(x, hy + r, low, [0, 1, 0]);
    go(x, hy + r + 2, low); go(x, hy + r + 2, high);
    y = 0; go(x, y, high);
  }
  return done('part', probeZFirst ? 'outerZ' : 'outer', 'outer');
}

export const isProbe3dAxis = (axis: string): axis is P3dAxis =>
  ['XYZ', 'XY', 'Z', 'X', 'Y', 'Center - Inner', 'Center - Outer'].includes(axis);
