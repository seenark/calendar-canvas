import { drawStrokes } from "@/drawing/render";

import type { ThumbnailRequest, ThumbnailResponse } from "./protocol";

self.onmessage = ({ data }: MessageEvent<ThumbnailRequest>) => {
  const { key, strokes, width, height, dpr } = data;
  try {
    const canvas = new OffscreenCanvas(Math.round(width * dpr), Math.round(height * dpr));
    drawStrokes(canvas.getContext("2d")!, strokes);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ key, bitmap } satisfies ThumbnailResponse, { transfer: [bitmap] });
  } catch (e) {
    self.postMessage({ key, error: String(e) } satisfies ThumbnailResponse);
  }
};
