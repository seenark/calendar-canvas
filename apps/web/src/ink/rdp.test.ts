import { describe, expect, it } from "vite-plus/test";
import { DAY_ASPECT } from "./constants";
import type { InkPoint } from "./point";
import { distanceToSegment, simplify } from "./rdp";

function noisyCurve(n: number): InkPoint[] {
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return {
      x: 0.1 + 0.8 * t + (rand() - 0.5) * 0.002,
      y: 0.5 + 0.3 * Math.sin(t * 6) + (rand() - 0.5) * 0.002,
      pressure: rand(),
    };
  });
}

describe("simplify", () => {
  it("returns short inputs unchanged", () => {
    expect(simplify([], 0.01)).toEqual([]);
    expect(simplify([{ x: 0, y: 0 }], 0.01)).toEqual([{ x: 0, y: 0 }]);
    const two = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(simplify(two, 0.01)).toEqual(two);
  });

  it("collapses collinear points to the endpoints", () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i / 19, y: i / 19 }));
    expect(simplify(line, 0.0005)).toEqual([line[0], line[19]]);
  });

  it("keeps the first and last points, in order, with their pressure", () => {
    const points = noisyCurve(500);
    const out = simplify(points, 0.0005);
    expect(out[0]).toBe(points[0]);
    expect(out.at(-1)).toBe(points.at(-1));
    expect(out.length).toBeLessThan(points.length);
    const indices = out.map((p) => points.indexOf(p));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("never deviates more than epsilon from the simplified path", () => {
    const points = noisyCurve(500);
    for (const epsilon of [0.0005, 0.002, 0.01]) {
      const out = simplify(points, epsilon);
      for (const p of points) {
        let nearest = Infinity;
        for (let i = 1; i < out.length; i++)
          nearest = Math.min(nearest, distanceToSegment(p, out[i - 1]!, out[i]!));
        expect(nearest).toBeLessThanOrEqual(epsilon + 1e-12);
      }
    }
  });

  it("measures y deviation in width units", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.0004 },
      { x: 1, y: 0 },
    ];
    expect(0.0004).toBeLessThan(0.00045);
    expect(0.0004 * DAY_ASPECT).toBeGreaterThan(0.00045);
    expect(simplify(points, 0.00045)).toHaveLength(3);
    expect(simplify(points, 0.00055)).toHaveLength(2);
  });

  it("keeps both ends of a closed loop", () => {
    const loop = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.2 },
    ];
    const out = simplify(loop, 0.0005);
    expect(out[0]).toBe(loop[0]);
    expect(out.at(-1)).toBe(loop[3]);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});
