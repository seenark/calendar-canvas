import { DAY_ASPECT } from "@/ink/constants";
import { MAX_MONTH_INDEX, MIN_MONTH_INDEX } from "@/lib/date";
import { monthGrid } from "@/month/grid";

/** Months listed on each side of the month the view opens on. */
export const MONTH_RANGE = 600;

/** First month index of the list window centred on `center`, kept inside the supported years. */
export function windowStart(center: number): number {
  return Math.min(
    Math.max(center - MONTH_RANGE, MIN_MONTH_INDEX),
    MAX_MONTH_INDEX - 2 * MONTH_RANGE,
  );
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
