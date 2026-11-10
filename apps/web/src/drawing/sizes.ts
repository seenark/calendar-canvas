import type { StrokeKind } from "./stroke";

/** Stroke widths are fractions of the Day's width. */
export const MIN_SIZE = 0.002;
export const MAX_SIZE = 0.2;

export const SIZE_PRESETS = {
  pen: [0.004, 0.008, 0.012, 0.02, 0.032],
  eraser: [0.02, 0.04, 0.06, 0.09, 0.13],
} as const satisfies Record<StrokeKind, readonly number[]>;

export const DEFAULT_PEN_SIZE = SIZE_PRESETS.pen[2];
export const DEFAULT_ERASER_SIZE = SIZE_PRESETS.eraser[1];

/** Vertical drag distance that doubles or halves the size while fine-tuning. */
const DRAG_DOUBLE_PX = 80;

export const clampSize = (size: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, size));

export const isValidSize = (v: unknown): v is number =>
  typeof v === "number" && v > 0 && v <= MAX_SIZE;

/** `dy` is the finger's vertical travel in px since the long-press began. Up (negative) grows the size. */
export const sizeFromDrag = (start: number, dy: number): number =>
  clampSize(start * 2 ** (-dy / DRAG_DOUBLE_PX));
