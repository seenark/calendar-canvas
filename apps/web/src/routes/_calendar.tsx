import { createFileRoute, Link, Outlet, redirect, useParams } from "@tanstack/react-router";

import { cn } from "@calendar-canvas/ui/lib/utils";

import { DAY_ASPECT } from "@/ink/constants";
import { ApiError, meQuery } from "@/lib/api";
import { daysOfMonth, formatThaiMonth, isYearMonth, monthOfDay, toDayKey } from "@/lib/date";

export const Route = createFileRoute("/_calendar")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({ to: "/login", search: { return: location.href } });
      }
      throw err;
    }
  },
  component: CalendarLayout,
});

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function CalendarLayout() {
  const { date, yearMonth } = useParams({ strict: false });
  const today = toDayKey(new Date());
  const candidate = yearMonth ?? (date ? monthOfDay(date) : undefined);
  const month = candidate && isYearMonth(candidate) ? candidate : monthOfDay(today);
  const { days, firstWeekday } = daysOfMonth(month);

  return (
    <>
      <main className="flex-1 overflow-y-auto p-2">
        <h1 className="py-2 text-center text-lg font-bold">{formatThaiMonth(month)}</h1>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAYS.map((w) => (
            <div key={w}>{w}</div>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {days.map((day) => (
            <Link
              key={day}
              to="/d/$date"
              params={{ date: day }}
              className={cn(
                "bg-paper text-paper-foreground p-1 text-left",
                day === today && "ring-ema ring-2",
              )}
              style={{ aspectRatio: `1 / ${DAY_ASPECT}` }}
            >
              {Number(day.slice(8))}
            </Link>
          ))}
        </div>
      </main>
      <Outlet />
    </>
  );
}
