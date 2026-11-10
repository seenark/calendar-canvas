import { describe, expect, it } from "vite-plus/test";
import { ERASER_MAX_RADIUS_FACTOR, PEN_MAX_RADIUS_FACTOR, strokeBBox } from "./bbox";
import { DAY_ASPECT } from "./constants";

const points = [
  { x: 0.2, y: 0.3 },
  { x: 0.6, y: 0.1 },
  { x: 0.4, y: 0.7 },
];

describe("strokeBBox", () => {
  it("contains a 0.75 * size disk around each Pen point", () => {
    const size = 0.02;
    const [minX, minY, maxX, maxY] = strokeBBox(points, size, "pen");
    const r = PEN_MAX_RADIUS_FACTOR * size;
    expect(PEN_MAX_RADIUS_FACTOR).toBe(0.75);
    for (const p of points) {
      expect(minX).toBeLessThanOrEqual(p.x - r + 1e-12);
      expect(maxX).toBeGreaterThanOrEqual(p.x + r - 1e-12);
      expect(minY).toBeLessThanOrEqual(p.y - r / DAY_ASPECT + 1e-12);
      expect(maxY).toBeGreaterThanOrEqual(p.y + r / DAY_ASPECT - 1e-12);
    }
  });

  it("uses a 0.5 * size radius for the Eraser", () => {
    const size = 0.02;
    const [minX, minY, maxX, maxY] = strokeBBox(points, size, "eraser");
    expect(ERASER_MAX_RADIUS_FACTOR).toBe(0.5);
    expect(minX).toBeCloseTo(0.2 - size / 2);
    expect(maxX).toBeCloseTo(0.6 + size / 2);
    expect(minY).toBeCloseTo(0.1 - size / 2 / DAY_ASPECT);
    expect(maxY).toBeCloseTo(0.7 + size / 2 / DAY_ASPECT);
  });

  it("covers a single point by the radius on every side", () => {
    const [minX, minY, maxX, maxY] = strokeBBox([{ x: 0.5, y: 0.5 }], 0.1, "pen");
    expect(maxX - minX).toBeCloseTo(0.15);
    expect((maxY - minY) * DAY_ASPECT).toBeCloseTo(0.15);
  });

  it("clamps point coordinates to [0, 1] before adding the radius", () => {
    const size = 0.1;
    const [minX, minY, maxX, maxY] = strokeBBox(
      [
        { x: -0.5, y: -2 },
        { x: 1.5, y: 3 },
      ],
      size,
      "eraser",
    );
    expect(minX).toBeCloseTo(-size / 2);
    expect(maxX).toBeCloseTo(1 + size / 2);
    expect(minY).toBeCloseTo(-size / 2 / DAY_ASPECT);
    expect(maxY).toBeCloseTo(1 + size / 2 / DAY_ASPECT);
  });

  it("rejects an empty Stroke", () => {
    expect(() => strokeBBox([], 0.01, "pen")).toThrow();
  });
});
