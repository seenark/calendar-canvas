import type { Stroke } from "@/drawing/stroke";

export type ThumbnailRequest = {
  key: string;
  day: string;
  /** The Day's composed Strokes. */
  strokes: readonly Stroke[];
  /** CSS pixels. The bitmap is `width * dpr` by `height * dpr`. */
  width: number;
  height: number;
  dpr: number;
};

export type ThumbnailResponse =
  | { key: string; bitmap: ImageBitmap }
  | { key: string; error: string };
