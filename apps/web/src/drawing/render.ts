import { REF_WIDTH, strokePath } from "./outline";
import type { Stroke } from "./stroke";

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The one place that turns a Stroke into an outline, so the Drawing page and the Day cell thumbnail cannot drift. */
export function strokeOutline(stroke: Stroke): Path2D {
  return strokePath(stroke.points, stroke.size, stroke.kind, stroke.hasPressure, true);
}

/** A null colour is the Eraser: it removes what is already on the canvas. */
export function fillOutline(ctx: Context2D, path: Path2D, color: string | null): void {
  const scale = ctx.canvas.width / REF_WIDTH;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = color === null ? "destination-out" : "source-over";
  if (color !== null) ctx.fillStyle = color;
  ctx.fill(path);
}

/** Paints a Day's composed Strokes in order onto a cleared canvas of any size. `outline` lets a caller cache paths. */
export function drawStrokes(
  ctx: Context2D,
  strokes: readonly Stroke[],
  outline: (stroke: Stroke) => Path2D = strokeOutline,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes) fillOutline(ctx, outline(s), s.color);
}
