import { format } from "date-fns";
import { th } from "date-fns/locale/th";

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

/** Parses a 'YYYY-MM-DD' Day key as a local date. Returns null unless it is a real calendar date. */
export function parseDay(day: string): Date | null {
  const m = DAY_KEY.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  date.setFullYear(y);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    ? date
    : null;
}

export function isYearMonth(value: string): boolean {
  const m = YEAR_MONTH.exec(value);
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function toDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

/** Days of a 'YYYY-MM' month in order, plus the weekday (Sunday = 0) of the first one. */
export function daysOfMonth(yearMonth: string): { days: string[]; firstWeekday: number } {
  const [y, m] = yearMonth.split("-").map(Number) as [number, number];
  const count = new Date(y, m, 0).getDate();
  const days = Array.from(
    { length: count },
    (_, i) => `${yearMonth}-${String(i + 1).padStart(2, "0")}`,
  );
  return { days, firstWeekday: new Date(y, m - 1, 1).getDay() };
}

/** Thai weekday, day and month with the Buddhist Era year (CE + 543). */
export function formatThaiDate(date: Date): string {
  return `${format(date, "EEEE d MMMM", { locale: th })} ${date.getFullYear() + 543}`;
}

export function formatThaiMonth(yearMonth: string): string {
  const date = parseDay(`${yearMonth}-01`)!;
  return `${format(date, "MMMM", { locale: th })} ${date.getFullYear() + 543}`;
}

/** Months since year 0, so month arithmetic is plain integer arithmetic. */
export function monthIndex(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number) as [number, number];
  return y * 12 + m - 1;
}

export function yearMonthOfIndex(index: number): string {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
