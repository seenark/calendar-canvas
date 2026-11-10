import { describe, expect, it } from "vite-plus/test";
import { MAX_SIZE, MIN_SIZE, SIZE_PRESETS, clampSize, isValidSize, sizeFromDrag } from "./sizes";

describe("SIZE_PRESETS", () => {
  it.each(["pen", "eraser"] as const)("has 5 ascending %s sizes inside the valid range", (kind) => {
    const sizes = SIZE_PRESETS[kind];
    expect(sizes).toHaveLength(5);
    expect([...sizes].sort((a, b) => a - b)).toEqual([...sizes]);
    for (const s of sizes) expect(isValidSize(s)).toBe(true);
  });
});

describe("clampSize", () => {
  it("keeps sizes inside [MIN_SIZE, MAX_SIZE]", () => {
    expect(clampSize(0)).toBe(MIN_SIZE);
    expect(clampSize(-1)).toBe(MIN_SIZE);
    expect(clampSize(5)).toBe(MAX_SIZE);
    expect(clampSize(0.02)).toBe(0.02);
  });
});

describe("isValidSize", () => {
  it("accepts [MIN_SIZE, MAX_SIZE] and rejects anything else", () => {
    expect(isValidSize(MAX_SIZE)).toBe(true);
    expect(isValidSize(MIN_SIZE)).toBe(true);
    expect(isValidSize(MIN_SIZE / 2)).toBe(false);
    expect(isValidSize(0)).toBe(false);
    expect(isValidSize(0.21)).toBe(false);
    expect(isValidSize("0.01")).toBe(false);
    expect(isValidSize(Number.NaN)).toBe(false);
  });
});

describe("sizeFromDrag", () => {
  it("is unchanged without travel", () => {
    expect(sizeFromDrag(0.02, 0)).toBe(0.02);
  });

  it("grows when dragged up and shrinks when dragged down", () => {
    expect(sizeFromDrag(0.02, -40)).toBeGreaterThan(0.02);
    expect(sizeFromDrag(0.02, 40)).toBeLessThan(0.02);
  });

  it("clamps at both ends", () => {
    expect(sizeFromDrag(0.1, -1000)).toBe(MAX_SIZE);
    expect(sizeFromDrag(0.01, 1000)).toBe(MIN_SIZE);
  });
});
