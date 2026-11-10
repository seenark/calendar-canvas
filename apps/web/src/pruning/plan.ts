import { REF_HEIGHT, REF_WIDTH } from "@/drawing/outline";
import { drawStrokes, strokeOutline } from "@/drawing/render";
import type { Stroke } from "@/drawing/stroke";
import { DAY_ASPECT } from "@/ink/constants";
import type { BBox } from "@/ink/bbox";
import type { ConfirmedStroke } from "@/sync/ops";

/** Strokes younger than this are neither pruned nor used as evidence. */
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Longest side, in pixels, of the canvas that decides whether a Pen Stroke is fully erased. */
export const ERASE_TEST_SIDE = 512;

export type PruneInput = {
  /** One Day's confirmed Strokes in ascending `seq`. Ineligible ones still count as drawing, not as evidence. */
  strokes: readonly ConfirmedStroke[];
  /** Epoch ms. */
  now: number;
  /** Ids named by Pending ops or the undo stacks. */
  protectedIds: ReadonlySet<string>;
  /** Verification canvas width in device pixels. Its height follows `DAY_ASPECT`. */
  width: number;
  createCanvas: (width: number, height: number) => OffscreenCanvas;
};

export type PruneResult = { deleteIds: string[] } | { aborted: string };

const overlaps = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Which Strokes of a Day can leave without changing its picture. The caller must still check `aborted`. */
export function planPrune(input: PruneInput): PruneResult {
  const { strokes, now, protectedIds, createCanvas } = input;
  const outlines = new Map<string, Path2D>();
  const outline = (s: Stroke) => {
    let path = outlines.get(s.id);
    if (!path) outlines.set(s.id, (path = strokeOutline(s)));
    return path;
  };
  const eligible = strokes.filter(
    (s) => s.receivedAt < now - MIN_AGE_MS && !protectedIds.has(s.id),
  );
  const erasers = eligible.filter((s) => s.kind === "eraser");
  const pruned = new Set<string>();

  for (const pen of eligible) {
    if (pen.kind !== "pen") continue;
    const evidence = erasers.filter((e) => e.seq > pen.seq && overlaps(e.bbox, pen.bbox));
    if (evidence.length > 0 && isFullyErased(pen, evidence)) pruned.add(pen.id);
  }

  const remainingPens = strokes.filter((s) => s.kind === "pen" && !pruned.has(s.id));
  for (const eraser of erasers)
    if (!remainingPens.some((p) => p.seq < eraser.seq && overlaps(p.bbox, eraser.bbox)))
      pruned.add(eraser.id);

  if (pruned.size === 0) return { deleteIds: [] };
  const height = Math.round(input.width * DAY_ASPECT);
  const before = pixelsOf(strokes, input.width, height);
  const after = pixelsOf(
    strokes.filter((s) => !pruned.has(s.id)),
    input.width,
    height,
  );
  const differing = countDifferences(before, after);
  if (differing > 0) return { aborted: `${differing} of ${before.length / 4} pixels differ` };
  return { deleteIds: [...pruned] };

  function isFullyErased(pen: ConfirmedStroke, evidence: readonly ConfirmedStroke[]): boolean {
    const [minX, minY, maxX, maxY] = pen.bbox;
    const x = minX * REF_WIDTH;
    const y = minY * REF_HEIGHT;
    const longest = Math.max((maxX - minX) * REF_WIDTH, (maxY - minY) * REF_HEIGHT);
    if (!(longest > 0)) return false;
    const scale = ERASE_TEST_SIDE / longest;
    const canvas = createCanvas(
      Math.max(1, Math.round((maxX - minX) * REF_WIDTH * scale)),
      Math.max(1, Math.round((maxY - minY) * REF_HEIGHT * scale)),
    );
    drawStrokes(canvas.getContext("2d")!, [pen, ...evidence], outline, { x, y, scale });
    return !hasInk(canvas);
  }

  function pixelsOf(list: readonly Stroke[], w: number, h: number): Uint8ClampedArray {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    drawStrokes(ctx, list, outline);
    return ctx.getImageData(0, 0, w, h).data;
  }

  function hasInk(canvas: OffscreenCanvas): boolean {
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) return true;
    return false;
  }
}

function countDifferences(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
      n++;
  return n;
}
