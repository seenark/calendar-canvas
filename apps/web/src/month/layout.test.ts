import { describe, expect, it } from "vite-plus/test";

import { MAX_MONTH_INDEX, MIN_MONTH_INDEX, monthIndex, yearMonthOfIndex } from "@/lib/date";

import { growAfter, growBefore, rangeAround, rangeContains, rectsIntersect } from "./layout";

function listed(range: { first: number; last: number }): string[] {
  return Array.from({ length: range.last - range.first + 1 }, (_, i) =>
    yearMonthOfIndex(range.first + i),
  );
}

describe("rangeAround", () => {
  it("lists the month and one on each side", () => {
    expect(listed(rangeAround(monthIndex("2026-11")))).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("crosses a year boundary", () => {
    expect(listed(rangeAround(monthIndex("2027-01")))).toEqual(["2026-12", "2027-01", "2027-02"]);
  });

  it("stops at the first supported month", () => {
    expect(listed(rangeAround(MIN_MONTH_INDEX))).toEqual(["1900-01", "1900-02"]);
  });

  it("stops at the last supported month", () => {
    expect(listed(rangeAround(MAX_MONTH_INDEX))).toEqual(["2199-11", "2199-12"]);
  });
});

describe("growAfter", () => {
  it("adds exactly the next month", () => {
    const range = rangeAround(monthIndex("2026-11"));
    expect(listed(growAfter(range))).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
  });

  it("leaves the range unchanged at the last supported month", () => {
    const range = rangeAround(MAX_MONTH_INDEX);
    expect(growAfter(range)).toBe(range);
  });
});

describe("growBefore", () => {
  it("adds exactly the previous month", () => {
    const range = rangeAround(monthIndex("2026-11"));
    expect(listed(growBefore(range))).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
  });

  it("leaves the range unchanged at the first supported month", () => {
    const range = rangeAround(MIN_MONTH_INDEX);
    expect(growBefore(range)).toBe(range);
  });
});

describe("rangeContains", () => {
  const range = rangeAround(monthIndex("2026-11"));

  it("is true for both ends", () => {
    expect(rangeContains(range, monthIndex("2026-10"))).toBe(true);
    expect(rangeContains(range, monthIndex("2026-12"))).toBe(true);
  });

  it("is true for a month between the ends", () => {
    expect(rangeContains(range, monthIndex("2026-11"))).toBe(true);
  });

  it("is false one month past each end", () => {
    expect(rangeContains(range, monthIndex("2026-09"))).toBe(false);
    expect(rangeContains(range, monthIndex("2027-01"))).toBe(false);
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
