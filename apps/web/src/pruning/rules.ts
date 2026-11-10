import { backingRatio } from "@/drawing/zoom";
import { DAY_ASPECT } from "@/ink/constants";

export const MIN_STROKES = 300;
export const MIN_ERASERS = 100;

/** The prune endpoint rejects a request with more ids than this. */
export const MAX_PRUNE_IDS = 1000;

type KindOnly = { kind: "pen" | "eraser" };

export function isBusy(strokes: readonly KindOnly[]): boolean {
  return (
    strokes.length >= MIN_STROKES ||
    strokes.filter((s) => s.kind === "eraser").length >= MIN_ERASERS
  );
}

/**
 * Whether a Day's Pruning may start now: `skip` when already started this session or not busy, `defer`
 * while a pointer is down, else `run`.
 */
export function pruneGate(
  strokes: readonly KindOnly[],
  alreadyStarted: boolean,
  pointersDown: number,
): "run" | "defer" | "skip" {
  if (alreadyStarted || !isBusy(strokes)) return "skip";
  return pointersDown > 0 ? "defer" : "run";
}

/**
 * Splits pruned ids into requests the server accepts: every Pen first, then every Eraser. Submitted in order,
 * a failure only ever leaves Erasers behind, which cannot change the picture. Dropping an Eraser before the
 * Pens it fully erased would make those Pens reappear.
 */
export function pruneBatches(
  ids: readonly string[],
  strokes: readonly (KindOnly & { id: string })[],
): string[][] {
  const erasers = new Set(strokes.filter((s) => s.kind === "eraser").map((s) => s.id));
  const ordered = [...ids.filter((id) => !erasers.has(id)), ...ids.filter((id) => erasers.has(id))];
  const batches: string[][] = [];
  for (let i = 0; i < ordered.length; i += MAX_PRUNE_IDS)
    batches.push(ordered.slice(i, i + MAX_PRUNE_IDS));
  return batches;
}

/**
 * Pixel width of the verification canvas: the Drawing page's paper at the engine's backing density at
 * zoom 1, so the check covers the picture the user sees whatever the viewport or zoom.
 */
export function verificationWidth(paperWidth: number, dpr: number): number {
  const box = { width: paperWidth, height: paperWidth * DAY_ASPECT };
  return Math.max(1, Math.round(paperWidth * backingRatio(dpr, 1, box)));
}
