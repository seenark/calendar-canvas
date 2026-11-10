import {
  DAY_ASPECT,
  DEFAULT_SIMPLIFY_EPSILON,
  MAX_STROKE_POINTS,
  PRESSURE_EPSILON,
} from "./constants";
import type { InkPoint } from "./point";

interface Split {
  lo: number;
  hi: number;
  index: number;
  dist: number;
}

/**
 * Ramer–Douglas–Peucker, best-first. `epsilon` is in width units; y is scaled by DAY_ASPECT so distances are isotropic.
 * Always keeps the first and last points. With `withPressure`, a point whose pressure strays from the
 * linear interpolation of its neighbours by more than PRESSURE_EPSILON, scaled by epsilon / DEFAULT_SIMPLIFY_EPSILON, is kept too.
 * Splits run from the largest deviation down and stop at `maxPoints` kept points, so the result is the best
 * `maxPoints`-point fit and every split costs one scan of its segment.
 */
export function simplify<P extends InkPoint>(
  points: readonly P[],
  epsilon = DEFAULT_SIMPLIFY_EPSILON,
  withPressure = false,
  maxPoints = Infinity,
): P[] {
  const pressureScale = DEFAULT_SIMPLIFY_EPSILON / PRESSURE_EPSILON;
  const n = points.length;
  if (n <= 2) return [...points];

  const farthest = (lo: number, hi: number): Split => {
    const a = points[lo]!;
    const b = points[hi]!;
    const pLo = a.pressure ?? 0;
    const pHi = b.pressure ?? 0;
    const mid = (lo + hi) / 2;
    let dist = 0;
    let index = -1;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i]!;
      let d = distanceToSegment(p, a, b);
      if (withPressure) {
        const expected = pLo + ((pHi - pLo) * (i - lo)) / (hi - lo);
        d = Math.max(d, Math.abs((p.pressure ?? 0) - expected) * pressureScale);
      }
      // Ties go to the point nearest the middle so a flat run splits in half, not one point at a time.
      if (d > dist || (d === dist && Math.abs(i - mid) < Math.abs(index - mid))) {
        dist = d;
        index = i;
      }
    }
    return { lo, hi, index, dist };
  };

  const heap: Split[] = [];
  const push = (split: Split) => {
    if (split.dist <= epsilon) return;
    let i = heap.push(split) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]!.dist >= split.dist) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = split;
  };
  const pop = (): Split => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= heap.length) break;
        if (child + 1 < heap.length && heap[child + 1]!.dist > heap[child]!.dist) child++;
        if (heap[child]!.dist <= last.dist) break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return top;
  };

  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  let kept = 2;
  push(farthest(0, n - 1));
  while (heap.length && kept < maxPoints) {
    const { lo, hi, index } = pop();
    keep[index] = 1;
    kept++;
    push(farthest(lo, index));
    push(farthest(index, hi));
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplifies with RDP at the default epsilon, loosening it only as far as the codec's point limit requires. */
export function fitToLimit<P extends InkPoint>(points: readonly P[], withPressure: boolean): P[] {
  return simplify(points, DEFAULT_SIMPLIFY_EPSILON, withPressure, MAX_STROKE_POINTS);
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
