import { isYearMonth, monthOfDay, toDayKey } from "@/lib/date";

const KEY = "lastMonth";

/** Storage can be unavailable or full, and losing the last month is harmless. */
export function rememberMonth(yearMonth: string): void {
  try {
    localStorage.setItem(KEY, yearMonth);
  } catch {}
}

/** The last month the list published to the URL, or the current month when none is stored. */
export function startMonth(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null && isYearMonth(stored)) return stored;
  } catch {}
  return monthOfDay(toDayKey(new Date()));
}
