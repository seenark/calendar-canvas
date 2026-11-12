import { DAY_ASPECT } from "@/ink/constants";
import { MAX_MONTH_INDEX, MIN_MONTH_INDEX } from "@/lib/date";
import { monthGrid } from "@/month/grid";

/** The consecutive months the Month view lists, both ends inclusive. */
export type MonthRange = { first: number; last: number };

/** Months listed on each side of the month the Month view opens or jumps to. */
export const RANGE_RADIUS = 3;

/** Months one pull at either edge adds. */
export const PULL_MONTHS = 3;

/** The month at `center` and `RANGE_RADIUS` months on each side, clamped to the supported years. */
export function rangeAround(center: number): MonthRange {
  return {
    first: Math.max(center - RANGE_RADIUS, MIN_MONTH_INDEX),
    last: Math.min(center + RANGE_RADIUS, MAX_MONTH_INDEX),
  };
}

export function rangeContains(range: MonthRange, index: number): boolean {
  return index >= range.first && index <= range.last;
}

/** The range with `PULL_MONTHS` before it added, or the same object at the first supported month. */
export function growBefore(range: MonthRange): MonthRange {
  return range.first <= MIN_MONTH_INDEX
    ? range
    : { first: Math.max(range.first - PULL_MONTHS, MIN_MONTH_INDEX), last: range.last };
}

/** The range with `PULL_MONTHS` after it added, or the same object at the last supported month. */
export function growAfter(range: MonthRange): MonthRange {
  return range.last >= MAX_MONTH_INDEX
    ? range
    : { first: range.first, last: Math.min(range.last + PULL_MONTHS, MAX_MONTH_INDEX) };
}

type Rect = { top: number; bottom: number; left: number; right: number };

/** Whether two rects share any area. Rects that only touch an edge do not intersect. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
}

export const HEADING_HEIGHT = 64;
export const GRID_GAP = 4;
export const MONTH_PADDING_X = 8;
export const MONTH_PADDING_BOTTOM = 12;

export function cellWidth(listWidth: number): number {
  return (listWidth - 2 * MONTH_PADDING_X - 6 * GRID_GAP) / 7;
}

/** Exact pixel height of a month item, so the virtual list never has to measure. */
export function monthItemHeight(listWidth: number, yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  const rows = monthGrid(year, month).weeks.length;
  return (
    HEADING_HEIGHT +
    rows * cellWidth(listWidth) * DAY_ASPECT +
    (rows - 1) * GRID_GAP +
    MONTH_PADDING_BOTTOM
  );
}
