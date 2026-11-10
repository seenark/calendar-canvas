import { DAY_ASPECT, DEFAULT_SIMPLIFY_EPSILON, PRESSURE_EPSILON } from "./constants";
import type { InkPoint } from "./point";

/**
 * Ramer–Douglas–Peucker. `epsilon` is in width units; y is scaled by DAY_ASPECT so distances are isotropic.
 * Always keeps the first and last points. With `withPressure`, a point whose pressure strays from the
 * linear interpolation of its neighbours by more than PRESSURE_EPSILON is kept too.
 */
export function simplify<P extends InkPoint>(
  points: readonly P[],
  epsilon = DEFAULT_SIMPLIFY_EPSILON,
  withPressure = false,
): P[] {
  const pressureScale = epsilon / PRESSURE_EPSILON;
  const n = points.length;
  if (n <= 2) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = lo + 1; i < hi; i++) {
      let d = distanceToSegment(points[i]!, points[lo]!, points[hi]!);
      if (withPressure) {
        const pLo = points[lo]!.pressure ?? 0;
        const pHi = points[hi]!.pressure ?? 0;
        const expected = pLo + ((pHi - pLo) * (i - lo)) / (hi - lo);
        d = Math.max(d, Math.abs((points[i]!.pressure ?? 0) - expected) * pressureScale);
      }
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > epsilon) {
      keep[index] = 1;
      stack.push([lo, index], [index, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function distanceToSegment(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const ax = a.x;
  const ay = a.y * DAY_ASPECT;
  const dx = b.x - ax;
  const dy = b.y * DAY_ASPECT - ay;
  const px = p.x - ax;
  const py = p.y * DAY_ASPECT - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
  return Math.hypot(px - t * dx, py - t * dy);
}
