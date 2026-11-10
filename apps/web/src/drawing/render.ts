import { REF_WIDTH, strokePath } from "./outline";
import type { Stroke } from "./stroke";

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The one place that turns a Stroke into an outline, so the Drawing page and the Day cell thumbnail cannot drift. */
export function strokeOutline(stroke: Stroke): Path2D {
  return strokePath(stroke.points, stroke.size, stroke.kind, stroke.hasPressure, true);
}

/** Which part of the reference space a canvas shows: `x`, `y` is its top-left corner and `scale` is canvas pixels per reference unit. */
export type Viewport = { x: number; y: number; scale: number };

/** A null colour is the Eraser: it removes what is already on the canvas. The viewport defaults to the whole Day. */
export function fillOutline(
  ctx: Context2D,
  path: Path2D,
  color: string | null,
  view?: Viewport,
): void {
  const scale = view?.scale ?? ctx.canvas.width / REF_WIDTH;
  ctx.setTransform(scale, 0, 0, scale, -(view?.x ?? 0) * scale, -(view?.y ?? 0) * scale);
  ctx.globalCompositeOperation = color === null ? "destination-out" : "source-over";
  if (color !== null) ctx.fillStyle = color;
  ctx.fill(path);
}

/** Paints a Day's composed Strokes in order onto a cleared canvas of any size. `outline` lets a caller cache paths. */
export function drawStrokes(
  ctx: Context2D,
  strokes: readonly Stroke[],
  outline: (stroke: Stroke) => Path2D = strokeOutline,
  view?: Viewport,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes) fillOutline(ctx, outline(s), s.color, view);
}
