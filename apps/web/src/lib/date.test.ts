import { describe, expect, it } from "vite-plus/test";

import {
  daysOfMonth,
  formatThaiDate,
  formatThaiMonth,
  isYearMonth,
  monthIndex,
  parseDay,
  toDayKey,
  yearMonthOfIndex,
} from "./date";

describe("parseDay", () => {
  it("accepts real dates, including a leap day", () => {
    expect(parseDay("2026-11-10")).not.toBeNull();
    expect(parseDay("2024-02-29")).not.toBeNull();
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of ["", "2026-1-1", "2026-13-01", "2026-02-30", "2025-02-29", "abcd-ef-gh"]) {
      expect(parseDay(bad)).toBeNull();
    }
  });

  it("round-trips through toDayKey", () => {
    expect(toDayKey(parseDay("2026-11-10")!)).toBe("2026-11-10");
  });
});

describe("Thai formatting", () => {
  it("shows weekday, day, month and Buddhist Era year", () => {
    expect(formatThaiDate(parseDay("2026-11-10")!)).toBe("อังคาร 10 พฤศจิกายน 2569");
  });

  it("formats a month heading", () => {
    expect(formatThaiMonth("2026-11")).toBe("พฤศจิกายน 2569");
  });
});

describe("month helpers", () => {
  it("lists the days and the Sunday-based first weekday", () => {
    const { days, firstWeekday } = daysOfMonth("2026-11");
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-11-01");
    expect(firstWeekday).toBe(0);
  });

  it("validates year-months", () => {
    expect(isYearMonth("2026-11")).toBe(true);
    expect(isYearMonth("2026-00")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
  });
});

describe("month index", () => {
  it("round-trips across a year boundary", () => {
    expect(yearMonthOfIndex(monthIndex("2026-12") + 1)).toBe("2027-01");
    expect(yearMonthOfIndex(monthIndex("2026-01") - 1)).toBe("2025-12");
  });
});
