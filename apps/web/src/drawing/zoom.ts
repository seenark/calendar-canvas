export type Zoom = { scale: number; tx: number; ty: number };
export type Pt = { x: number; y: number };
export type Box = { width: number; height: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const MAX_BACKING_PX = 4096;
export const IDENTITY_ZOOM: Zoom = { scale: 1, tx: 0, ty: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Scale within [1, 4] and a translation that keeps the scaled paper covering the whole box. */
export function clampZoom(z: Zoom, box: Box): Zoom {
  const scale = clamp(z.scale, MIN_SCALE, MAX_SCALE);
  return {
    scale,
    tx: clamp(z.tx, box.width * (1 - scale), 0),
    ty: clamp(z.ty, box.height * (1 - scale), 0),
  };
}

/** Two-finger gesture. Points are in box-local CSS px. The paper point under the start midpoint follows the current midpoint, so the same call zooms and pans. */
export function pinchZoom(start: Zoom, from: [Pt, Pt], to: [Pt, Pt], box: Box): Zoom {
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const scale = clamp(start.scale * (d0 > 0 ? d1 / d0 : 1), MIN_SCALE, MAX_SCALE);
  const m0 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const m1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  const px = (m0.x - start.tx) / start.scale;
  const py = (m0.y - start.ty) / start.scale;
  return clampZoom({ scale, tx: m1.x - px * scale, ty: m1.y - py * scale }, box);
}

export function zoomTransform(z: Zoom): string {
  return `translate(${z.tx}px, ${z.ty}px) scale(${z.scale})`;
}

/** Backing-store pixels per CSS px: sharp at the zoom, but never more than MAX_BACKING_PX on the longer side. */
export function backingRatio(dpr: number, scale: number, box: Box): number {
  return Math.min(dpr * scale, MAX_BACKING_PX / Math.max(box.width, box.height));
}
