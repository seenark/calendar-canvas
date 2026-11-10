import { describe, expect, it } from "vite-plus/test";

import { DAY_ASPECT } from "@/ink/constants";

import { monthGrid } from "./grid";
import { GRID_GAP, HEADING_HEIGHT, MONTH_PADDING_BOTTOM, monthItemHeight } from "./layout";

describe("monthGrid", () => {
  it("uses 4 rows for a non-leap February that starts on Sunday", () => {
    const { weeks } = monthGrid(2026, 2);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]![0]).toBe("2026-02-01");
    expect(weeks[3]![6]).toBe("2026-02-28");
  });

  it("uses 6 rows for a 31-day month that starts on Saturday", () => {
    const { weeks } = monthGrid(2026, 8);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-08-01"]);
    expect(weeks[5]).toEqual(["2026-08-30", "2026-08-31", null, null, null, null, null]);
  });

  it("includes the leap day in February 2028", () => {
    const { weeks } = monthGrid(2028, 2);
    expect(weeks).toHaveLength(5);
    expect(weeks.flat()).toContain("2028-02-29");
    expect(weeks[0]).toEqual([
      null,
      null,
      "2028-02-01",
      "2028-02-02",
      "2028-02-03",
      "2028-02-04",
      "2028-02-05",
    ]);
  });

  it("holds every Day exactly once in 7-wide weeks", () => {
    const { weeks } = monthGrid(2026, 11);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(30);
  });
});

describe("monthItemHeight", () => {
  const width = 398;
  const cellHeight = ((width - 16 - 6 * GRID_GAP) / 7) * DAY_ASPECT;

  it("adds the heading, rows, gaps and bottom padding", () => {
    expect(monthItemHeight(width, "2026-02")).toBeCloseTo(
      HEADING_HEIGHT + 4 * cellHeight + 3 * GRID_GAP + MONTH_PADDING_BOTTOM,
      9,
    );
    expect(monthItemHeight(width, "2026-08")).toBeCloseTo(
      HEADING_HEIGHT + 6 * cellHeight + 5 * GRID_GAP + MONTH_PADDING_BOTTOM,
      9,
    );
  });

  it("grows with every extra row by one cell height and one gap", () => {
    expect(monthItemHeight(width, "2028-02") - monthItemHeight(width, "2026-02")).toBeCloseTo(
      cellHeight + GRID_GAP,
      9,
    );
  });
});
