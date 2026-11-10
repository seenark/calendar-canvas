import { describe, expect, it } from "vite-plus/test";

import {
  daysOfMonth,
  formatThaiDate,
  formatThaiMonth,
  isDayKey,
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

  it("supports years 1900 to 2199 only", () => {
    expect(isYearMonth("1900-01")).toBe(true);
    expect(isYearMonth("2199-12")).toBe(true);
    expect(isYearMonth("1899-12")).toBe(false);
    expect(isYearMonth("2200-01")).toBe(false);
    expect(isYearMonth("0026-01")).toBe(false);
    expect(isDayKey("2199-12-31")).toBe(true);
    expect(isDayKey("2200-01-01")).toBe(false);
    expect(isDayKey("0099-01-01")).toBe(false);
    expect(isDayKey("2025-02-29")).toBe(false);
  });

  it("never reads a year below 100 as 19xx", () => {
    expect(parseDay("0099-03-05")!.getFullYear()).toBe(99);
    expect(daysOfMonth("0004-02").days).toHaveLength(29);
  });
});

describe("month index", () => {
  it("round-trips across a year boundary", () => {
    expect(yearMonthOfIndex(monthIndex("2026-12") + 1)).toBe("2027-01");
    expect(yearMonthOfIndex(monthIndex("2026-01") - 1)).toBe("2025-12");
  });
});
