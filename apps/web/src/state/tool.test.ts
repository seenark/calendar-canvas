import { describe, expect, it } from "vite-plus/test";

import { PALETTE } from "@/drawing/palette";

import { isEraserSettings, isPenSettings, isRecentColors } from "./tool";

describe("isPenSettings", () => {
  it("accepts a hex colour with a valid size", () => {
    expect(isPenSettings({ color: "#d20f39", size: 0.012 })).toBe(true);
    expect(isPenSettings({ color: "#ABCDEF", size: 0.2 })).toBe(true);
  });

  it("accepts every palette colour", () => {
    expect(PALETTE.every((color) => isPenSettings({ color, size: 0.01 }))).toBe(true);
  });

  it.each(["red", "#fff", "#12345g", "#1234567", "4c4f69", "", "url(x)", 5, null])(
    "rejects the colour %j",
    (color) => {
      expect(isPenSettings({ color, size: 0.01 })).toBe(false);
    },
  );

  it.each([0, -1, 0.3, "0.01", null])("rejects the size %j", (size) => {
    expect(isPenSettings({ color: "#4c4f69", size })).toBe(false);
  });

  it("rejects missing fields and non-objects", () => {
    expect(isPenSettings({ color: "#4c4f69" })).toBe(false);
    expect(isPenSettings({ size: 0.01 })).toBe(false);
    expect(isPenSettings(null)).toBe(false);
    expect(isPenSettings("#4c4f69")).toBe(false);
  });
});

describe("isEraserSettings", () => {
  it("accepts a valid size only", () => {
    expect(isEraserSettings({ size: 0.04 })).toBe(true);
    expect(isEraserSettings({ size: 0 })).toBe(false);
    expect(isEraserSettings({})).toBe(false);
    expect(isEraserSettings(null)).toBe(false);
  });
});

describe("isRecentColors", () => {
  it("accepts an empty list and up to 5 unique hex colours", () => {
    expect(isRecentColors([])).toBe(true);
    expect(isRecentColors(PALETTE.slice(0, 5))).toBe(true);
  });

  it("rejects more than 5 colours", () => {
    expect(isRecentColors(PALETTE.slice(0, 6))).toBe(false);
  });

  it("rejects duplicates", () => {
    expect(isRecentColors(["#d20f39", "#d20f39"])).toBe(false);
  });

  it("rejects a list holding any invalid colour", () => {
    expect(isRecentColors(["#d20f39", "red"])).toBe(false);
    expect(isRecentColors(["#d20f39", 7])).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isRecentColors(null)).toBe(false);
    expect(isRecentColors("#d20f39")).toBe(false);
  });
});
