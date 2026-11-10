import { describe, expect, it } from "vite-plus/test";

import { backingRatio, clampZoom, IDENTITY_ZOOM, pinchZoom, zoomTransform } from "./zoom";

const box = { width: 400, height: 500 };

describe("clampZoom", () => {
  it("limits scale to 1..4", () => {
    expect(clampZoom({ scale: 0.5, tx: 0, ty: 0 }, box).scale).toBe(1);
    expect(clampZoom({ scale: 9, tx: 0, ty: 0 }, box).scale).toBe(4);
  });

  it("keeps the paper covering the box", () => {
    expect(clampZoom({ scale: 2, tx: 50, ty: 50 }, box)).toEqual({ scale: 2, tx: 0, ty: 0 });
    expect(clampZoom({ scale: 2, tx: -999, ty: -999 }, box)).toEqual({
      scale: 2,
      tx: -400,
      ty: -500,
    });
  });

  it("forces zero translation at scale 1", () => {
    expect(clampZoom({ scale: 1, tx: -30, ty: 20 }, box)).toEqual(IDENTITY_ZOOM);
  });
});

describe("pinchZoom", () => {
  const from: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 150, y: 200 },
    { x: 250, y: 200 },
  ];

  it("keeps the paper point under the midpoint fixed", () => {
    const z = pinchZoom(
      IDENTITY_ZOOM,
      from,
      [
        { x: 100, y: 200 },
        { x: 300, y: 200 },
      ],
      box,
    );
    expect(z).toEqual({ scale: 2, tx: -200, ty: -200 });
    expect(200 * z.scale + z.tx).toBe(200);
  });

  it("clamps scale at 4 and 1", () => {
    const wide = pinchZoom(
      IDENTITY_ZOOM,
      from,
      [
        { x: 0, y: 200 },
        { x: 400, y: 200 },
      ],
      box,
    );
    expect(wide.scale).toBe(4);
    const squeezed = pinchZoom({ scale: 2, tx: -200, ty: -200 }, from, [from[0], from[0]], box);
    expect(squeezed).toEqual(IDENTITY_ZOOM);
  });

  it("pans with the midpoint and clamps at the paper edge", () => {
    const start = { scale: 2, tx: -200, ty: -200 };
    const panned = pinchZoom(
      start,
      from,
      [
        { x: 160, y: 210 },
        { x: 260, y: 210 },
      ],
      box,
    );
    expect(panned).toEqual({ scale: 2, tx: -190, ty: -190 });
    const far = pinchZoom(
      start,
      from,
      [
        { x: 1150, y: 1200 },
        { x: 1250, y: 1200 },
      ],
      box,
    );
    expect(far).toEqual({ scale: 2, tx: 0, ty: 0 });
  });

  it("ignores a zero-length start", () => {
    const z = pinchZoom(IDENTITY_ZOOM, [from[0], from[0]], from, box);
    expect(z.scale).toBe(1);
  });
});

describe("backingRatio", () => {
  it("multiplies dpr by scale", () => {
    expect(backingRatio(2, 2, box)).toBe(4);
  });

  it("caps the longer side at 4096 px", () => {
    const ratio = backingRatio(3, 4, box);
    expect(ratio * box.height).toBe(4096);
    expect(ratio * box.width).toBeLessThanOrEqual(4096);
  });
});

describe("zoomTransform", () => {
  it("formats a CSS transform", () => {
    expect(zoomTransform({ scale: 2, tx: -10, ty: -20 })).toBe("translate(-10px, -20px) scale(2)");
  });
});
