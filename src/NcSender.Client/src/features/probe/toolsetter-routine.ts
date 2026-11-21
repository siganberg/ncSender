/*
 * The Tool Length Setter's moves, for the picture in the probe dialog. It
 * follows the routine the server sends (StandardBlockStrategy.GetZProbeRoutine
 * with the setter's values): a fast touch, a lift and a pause, a slow touch
 * that sets Z, and a lift to park.
 *
 * Frame: the setter's axis through the origin, Z up from the material it
 * stands on to the top of its plunger at 48. Millimetres.
 */
export interface TlsPoint {
  p: [number, number, number];
  /** Which step this move belongs to. */
  step: number;
  /** A touch: the surface's normal, toward the tool. */
  n?: [number, number, number];
  /** Seconds to wait here, where it is not the usual pause at a touch. */
  hold?: number;
  /** How fast the tool comes here, as a share of the usual speed. */
  speed?: number;
}
export interface TlsStep { key: string; sets: string }
export interface TlsRoutine { points: TlsPoint[]; steps: TlsStep[] }

/** `press`: how far the picture pushes the plunger in on each touch. */
export const TLS = { top: 48, radius: 14, press: [2.2, 1.2], lift: 4 } as const;

export function buildToolSetterRoutine(): TlsRoutine {
  const points: TlsPoint[] = [];
  const steps: TlsStep[] = [];
  let step = 0;
  const begin = (key: string, sets: string) => { steps.push({ key, sets }); step = steps.length - 1; };
  const x = 0, y = 0;

  begin('fast', '');
  points.push({ p: [x, y, TLS.top + 22], step });
  points.push({ p: [x, y, TLS.top - TLS.press[0]], step, n: [0, 0, 1] });
  begin('lift', '');
  points.push({ p: [x, y, TLS.top + TLS.lift], step, hold: 0.6 });
  begin('slow', 'Z');
  points.push({ p: [x, y, TLS.top - TLS.press[1]], step, n: [0, 0, 1], speed: 0.3 });
  begin('park', '');
  points.push({ p: [x, y, TLS.top + TLS.lift], step });
  return { points, steps };
}
