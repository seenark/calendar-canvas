import getStroke from "perfect-freehand";

import { DAY_ASPECT } from "@/ink/constants";
import type { InkPoint } from "@/ink/point";

import type { StrokeKind } from "./stroke";

/** Outlines are built in a fixed reference space (width REF_WIDTH) so a cached Path2D survives resizes. */
export const REF_WIDTH = 1000;
export const REF_HEIGHT = REF_WIDTH * DAY_ASPECT;

/** The Eraser's width ignores pressure, so thinning is 0 and its outline radius is always `size / 2`. */
const THINNING: Record<StrokeKind, number> = { pen: 0.5, eraser: 0 };

export function strokePath(
  points: readonly InkPoint[],
  size: number,
  kind: StrokeKind,
  hasPressure: boolean,
  last: boolean,
): Path2D {
  const outline = getStroke(
    points.map((p) => [p.x * REF_WIDTH, p.y * REF_HEIGHT, p.pressure ?? 0.5]),
    {
      size: size * REF_WIDTH,
      thinning: THINNING[kind],
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: !hasPressure,
      last,
    },
  );
  const path = new Path2D();
  const n = outline.length;
  if (n === 0) return path;
  path.moveTo(outline[0]![0]!, outline[0]![1]!);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i]!;
    const [x1, y1] = outline[(i + 1) % n]!;
    path.quadraticCurveTo(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
  }
  path.closePath();
  return path;
}
