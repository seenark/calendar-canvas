import { createFileRoute, Outlet, redirect, useParams } from "@tanstack/react-router";

import { fetchMe } from "@/lib/api";
import { isYearMonth, monthOfDay, toDayKey } from "@/lib/date";
import { MonthView } from "@/month/month-view";

export const Route = createFileRoute("/_calendar")({
  beforeLoad: async ({ context, location }) => {
    const me = await fetchMe(context.queryClient);
    if (!me) throw redirect({ to: "/login", search: { return: location.href } });
    if (me.role !== "user") throw redirect({ to: "/admin" });
  },
  component: CalendarLayout,
});

function CalendarLayout() {
  const { date, yearMonth } = useParams({ strict: false });
  const routeMonth = yearMonth && isYearMonth(yearMonth) ? yearMonth : undefined;
  const candidate = routeMonth ?? (date ? monthOfDay(date) : undefined);
  const month = candidate && isYearMonth(candidate) ? candidate : monthOfDay(toDayKey(new Date()));

  return (
    <>
      <MonthView initialMonth={month} routeMonth={routeMonth} />
      <Outlet />
    </>
  );
}
