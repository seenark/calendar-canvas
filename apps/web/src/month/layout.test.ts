import { describe, expect, it } from "vite-plus/test";

import { MAX_MONTH_INDEX, MIN_MONTH_INDEX, monthIndex } from "@/lib/date";

import { MONTH_RANGE, rectsIntersect, WINDOW_COUNT, windowContains, windowStart } from "./layout";

describe("windowStart", () => {
  it("centres the window on the month", () => {
    const center = monthIndex("2026-11");
    expect(windowStart(center)).toBe(center - MONTH_RANGE);
  });

  it("keeps the window inside the supported years", () => {
    expect(windowStart(MIN_MONTH_INDEX)).toBe(MIN_MONTH_INDEX);
    expect(windowStart(MAX_MONTH_INDEX)).toBe(MAX_MONTH_INDEX - 2 * MONTH_RANGE);
  });
});

describe("windowContains", () => {
  const first = monthIndex("2026-11") - MONTH_RANGE;

  it("lists every month of the window and none beyond it", () => {
    expect(windowContains(first, first)).toBe(true);
    expect(windowContains(first, first + WINDOW_COUNT - 1)).toBe(true);
    expect(windowContains(first, first - 1)).toBe(false);
    expect(windowContains(first, first + WINDOW_COUNT)).toBe(false);
  });

  it("needs a rebase for a month outside the window and none for one inside", () => {
    const far = monthIndex("2026-11") + MONTH_RANGE + 1;
    expect(windowContains(first, far)).toBe(false);
    expect(windowContains(windowStart(far), far)).toBe(true);
  });
});

describe("rectsIntersect", () => {
  const scroller = { top: 100, bottom: 700, left: 0, right: 400 };

  it("is true for a cell inside the scroll container", () => {
    expect(rectsIntersect({ top: 200, bottom: 300, left: 10, right: 60 }, scroller)).toBe(true);
  });

  it("is true for a cell partly clipped by the container edge", () => {
    expect(rectsIntersect({ top: 60, bottom: 160, left: 10, right: 60 }, scroller)).toBe(true);
  });

  it("is false for a cell fully behind the header above the container", () => {
    expect(rectsIntersect({ top: 20, bottom: 100, left: 10, right: 60 }, scroller)).toBe(false);
  });

  it("is false for a cell below the container", () => {
    expect(rectsIntersect({ top: 700, bottom: 800, left: 10, right: 60 }, scroller)).toBe(false);
  });
});
