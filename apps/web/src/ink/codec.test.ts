import { describe, expect, it } from "vite-plus/test";
import { bytesToBase64, base64ToBytes } from "./base64";
import { decodePoints, encodePoints } from "./codec";
import { MAX_STROKE_POINTS } from "./constants";
import type { InkPoint } from "./point";

const STEP = 1 / 65535;
const PRESSURE_STEP = 1 / 255;

function walk(n: number, withPressure: boolean): InkPoint[] {
  let seed = 12345;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: n }, () => {
    const p: InkPoint = { x: rand(), y: rand() };
    if (withPressure) p.pressure = rand();
    return p;
  });
}

function expectClose(actual: InkPoint[], expected: InkPoint[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    expect(Math.abs(actual[i]!.x - e.x)).toBeLessThanOrEqual(STEP / 2 + 1e-12);
    expect(Math.abs(actual[i]!.y - e.y)).toBeLessThanOrEqual(STEP / 2 + 1e-12);
    if (e.pressure !== undefined) {
      expect(Math.abs(actual[i]!.pressure! - e.pressure)).toBeLessThanOrEqual(
        PRESSURE_STEP / 2 + 1e-12,
      );
    } else {
      expect(actual[i]).not.toHaveProperty("pressure");
    }
  });
}

describe("ink codec v1", () => {
  it("writes version, flags and point count", () => {
    const bytes = encodePoints([{ x: 0, y: 0 }], { hasPressure: false });
    expect([...bytes]).toEqual([1, 0, 1, 0, 0]);
    expect(encodePoints([{ x: 0, y: 0, pressure: 1 }], { hasPressure: true })[1]).toBe(1);
  });

  it("round-trips without pressure", () => {
    const points = walk(50, false);
    const decoded = decodePoints(encodePoints(points, { hasPressure: false }));
    expect(decoded.hasPressure).toBe(false);
    expectClose(decoded.points, points);
  });

  it("round-trips with pressure", () => {
    const points = walk(50, true);
    const decoded = decodePoints(encodePoints(points, { hasPressure: true }));
    expect(decoded.hasPressure).toBe(true);
    expectClose(decoded.points, points);
  });

  it("round-trips negative deltas and full-range jumps", () => {
    const points: InkPoint[] = [
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 0.5, y: 0.25 },
      { x: 0.4, y: 0.2 },
      { x: 1, y: 0 },
    ];
    const decoded = decodePoints(encodePoints(points, { hasPressure: false }));
    expectClose(decoded.points, points);
    expect(decoded.points[0]).toEqual({ x: 1, y: 1 });
    expect(decoded.points[1]).toEqual({ x: 0, y: 0 });
  });

  it("round-trips a single point", () => {
    const points = [{ x: 0.3, y: 0.7, pressure: 0.5 }];
    expectClose(decodePoints(encodePoints(points, { hasPressure: true })).points, points);
  });

  it("round-trips an empty Stroke", () => {
    expect(decodePoints(encodePoints([], { hasPressure: false })).points).toEqual([]);
  });

  it("round-trips the maximum point count and rejects one more", () => {
    const points = walk(MAX_STROKE_POINTS, true);
    expectClose(decodePoints(encodePoints(points, { hasPressure: true })).points, points);
    expect(() =>
      encodePoints(walk(MAX_STROKE_POINTS + 1, false), { hasPressure: false }),
    ).toThrow();
  });

  it("keeps quantization error within one uint16 step and clamps out-of-range input", () => {
    const decoded = decodePoints(
      encodePoints(
        [
          { x: 0.123456, y: 0.654321 },
          { x: 1.2, y: -0.1 },
        ],
        { hasPressure: false },
      ),
    );
    expect(Math.abs(decoded.points[0]!.x - 0.123456)).toBeLessThanOrEqual(STEP);
    expect(Math.abs(decoded.points[0]!.y - 0.654321)).toBeLessThanOrEqual(STEP);
    expect(decoded.points[1]).toEqual({ x: 1, y: 0 });
  });

  it("survives base64 transport", () => {
    const points = walk(200, true);
    const bytes = encodePoints(points, { hasPressure: true });
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("rejects unknown versions", () => {
    const bytes = encodePoints([{ x: 0.5, y: 0.5 }], { hasPressure: false });
    for (const version of [0, 2, 255]) {
      const bad = Uint8Array.from(bytes);
      bad[0] = version;
      expect(() => decodePoints(bad)).toThrow(/version/);
    }
    expect(() => decodePoints(new Uint8Array())).toThrow(/version/);
  });

  it("rejects truncated, trailing, oversized and unknown-flag data", () => {
    const bytes = encodePoints(walk(5, true), { hasPressure: true });
    expect(() => decodePoints(bytes.subarray(0, bytes.length - 1))).toThrow();
    expect(() => decodePoints(Uint8Array.from([...bytes, 0]))).toThrow();
    expect(() => decodePoints(Uint8Array.from([1, 0, 0xa1, 0x1f]))).toThrow();
    expect(() => decodePoints(Uint8Array.from([1, 2, 0]))).toThrow();
  });
});
