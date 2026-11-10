import { createFileRoute, Outlet, redirect, useParams } from "@tanstack/react-router";
import { AnimatePresence, MotionConfig, useReducedMotion } from "motion/react";

import { DrawingPage } from "@/drawing/drawing-page";
import { ApiError, fetchMe } from "@/lib/api";
import { isDayKey, isYearMonth, monthOfDay, toDayKey } from "@/lib/date";
import { MonthView } from "@/month/month-view";

const TRANSITION = {
  default: { duration: 0.2 },
  layout: { type: "spring", duration: 0.4, bounce: 0 },
} as const;
const INSTANT = { duration: 0 } as const;

export const Route = createFileRoute("/_calendar")({
  beforeLoad: async ({ context, location }) => {
    const me = await fetchMe(context.queryClient).catch((err) => {
      if (err instanceof ApiError) throw err;
      throw redirect({ to: "/login", search: { return: location.href, error: "offline" } });
    });
    if (!me) throw redirect({ to: "/login", search: { return: location.href } });
    if (me.role !== "user") throw redirect({ to: "/admin" });
  },
  component: CalendarLayout,
});

function CalendarLayout() {
  const { date, yearMonth } = useParams({ strict: false });
  const reducedMotion = useReducedMotion();
  const routeMonth = yearMonth && isYearMonth(yearMonth) ? yearMonth : undefined;
  const openDay = date && isDayKey(date) ? date : undefined;
  const candidate = routeMonth ?? (openDay ? monthOfDay(openDay) : undefined);
  const month = candidate && isYearMonth(candidate) ? candidate : monthOfDay(toDayKey(new Date()));

  return (
    <MotionConfig transition={reducedMotion ? INSTANT : TRANSITION}>
      <MonthView initialMonth={month} routeMonth={routeMonth} />
      <AnimatePresence initial={false}>
        {openDay && <DrawingPage key={openDay} date={openDay} />}
      </AnimatePresence>
      <Outlet />
    </MotionConfig>
  );
}
