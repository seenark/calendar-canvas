import { DAY_ASPECT } from "./constants";
import type { InkPoint } from "./point";

export type BBox = [minX: number, minY: number, maxX: number, maxY: number];

/** perfect-freehand radius is `size * (0.5 - thinning * (0.5 - pressure))`, peaking at pressure 1. Pen uses thinning 0.5, Eraser thinning 0. */
export const PEN_MAX_RADIUS_FACTOR = 0.75;
export const ERASER_MAX_RADIUS_FACTOR = 0.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** `size` is the Stroke width as a fraction of Day width, so the radius in y is divided by DAY_ASPECT. Points are clamped to [0, 1] like `encodePoints` stores them. */
export function strokeBBox(
  points: readonly InkPoint[],
  size: number,
  kind: "pen" | "eraser",
): BBox {
  if (points.length === 0) throw new RangeError("strokeBBox needs at least one point");
  const rx = size * (kind === "pen" ? PEN_MAX_RADIUS_FACTOR : ERASER_MAX_RADIUS_FACTOR);
  const ry = rx / DAY_ASPECT;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const x = clamp01(p.x);
    const y = clamp01(p.y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX - rx, minY - ry, maxX + rx, maxY + ry];
}
