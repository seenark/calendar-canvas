import type { BBox } from "@/ink/bbox";
import type { InkPoint } from "@/ink/point";

export type StrokeKind = "pen" | "eraser";

export type Stroke = {
  /** UUIDv7, generated on the client. */
  id: string;
  /** Day key, 'YYYY-MM-DD' in the device's local time zone. */
  day: string;
  kind: StrokeKind;
  /** Null for the Eraser. */
  color: string | null;
  /** Width as a fraction of the Day's width. */
  size: number;
  /** Normalized to the Day: x of width, y of height, both in [0, 1]. */
  points: InkPoint[];
  hasPressure: boolean;
  bbox: BBox;
  createdAt: number;
};
