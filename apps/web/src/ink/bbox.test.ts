import { describe, expect, it } from "vite-plus/test";
import { strokeBBox } from "./bbox";
import { DAY_ASPECT } from "./constants";

describe("strokeBBox", () => {
  it("includes the Stroke radius", () => {
    const size = 0.02;
    const [minX, minY, maxX, maxY] = strokeBBox(
      [
        { x: 0.2, y: 0.3 },
        { x: 0.6, y: 0.1 },
        { x: 0.4, y: 0.7 },
      ],
      size,
    );
    expect(minX).toBeCloseTo(0.2 - size / 2);
    expect(maxX).toBeCloseTo(0.6 + size / 2);
    expect(minY).toBeCloseTo(0.1 - size / 2 / DAY_ASPECT);
    expect(maxY).toBeCloseTo(0.7 + size / 2 / DAY_ASPECT);
  });

  it("covers a single point by the radius on every side", () => {
    const [minX, minY, maxX, maxY] = strokeBBox([{ x: 0.5, y: 0.5 }], 0.1);
    expect(maxX - minX).toBeCloseTo(0.1);
    expect((maxY - minY) * DAY_ASPECT).toBeCloseTo(0.1);
  });

  it("rejects an empty Stroke", () => {
    expect(() => strokeBBox([], 0.01)).toThrow();
  });
});
