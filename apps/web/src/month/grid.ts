import { daysOfMonth, yearMonthOfIndex } from "@/lib/date";

export interface MonthGrid {
  /** Sunday-first weeks of Day keys, with null for the cells outside the month. */
  weeks: (string | null)[][];
}

/** `month` is 1 to 12. */
export function monthGrid(year: number, month: number): MonthGrid {
  const { days, firstWeekday } = daysOfMonth(yearMonthOfIndex(year * 12 + month - 1));
  const cells: (string | null)[] = [...Array<null>(firstWeekday).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks };
}
