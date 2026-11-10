import type { Stroke } from "@/drawing/stroke";

import type { ConfirmedStroke } from "./ops";

export const stroke = (id: string, kind: Stroke["kind"] = "pen", day = "2026-11-10"): Stroke => ({
  id,
  day,
  kind,
  color: kind === "pen" ? "#000000" : null,
  size: 0.01,
  points: [{ x: 0.1, y: 0.1 }],
  hasPressure: false,
  bbox: [0, 0, 0.2, 0.2],
  createdAt: 0,
});

export const confirmed = (id: string, seq: number): ConfirmedStroke => ({
  ...stroke(id),
  seq,
  receivedAt: seq,
});
