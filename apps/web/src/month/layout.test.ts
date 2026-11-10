import { describe, expect, it } from "vite-plus/test";

import { MAX_MONTH_INDEX, MIN_MONTH_INDEX, monthIndex } from "@/lib/date";

import { MONTH_RANGE, windowStart } from "./layout";

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
