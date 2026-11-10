import type { ConfirmedStroke } from "@/sync/ops";

export type PruningRequest = {
  strokes: readonly ConfirmedStroke[];
  now: number;
  protectedIds: string[];
  /** Verification canvas width in device pixels. */
  width: number;
};
