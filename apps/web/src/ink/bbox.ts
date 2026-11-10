import { DAY_ASPECT } from "./constants";
import type { InkPoint } from "./point";

export type BBox = [minX: number, minY: number, maxX: number, maxY: number];

/** `size` is the Stroke width as a fraction of Day width, so the radius in y is divided by DAY_ASPECT. */
export function strokeBBox(points: readonly InkPoint[], size: number): BBox {
  if (points.length === 0) throw new RangeError("strokeBBox needs at least one point");
  const rx = size / 2;
  const ry = rx / DAY_ASPECT;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX - rx, minY - ry, maxX + rx, maxY + ry];
}
