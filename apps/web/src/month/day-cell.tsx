import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

import { cn } from "@calendar-canvas/ui/lib/utils";

import { DAY_ASPECT } from "@/ink/constants";
import { formatThaiDate, parseDay } from "@/lib/date";
import { rectsIntersect } from "@/month/layout";
import { Thumbnail } from "@/thumbnails/thumbnail";

export const dayLayoutId = (day: string) => `day-${day}`;

/** Whether the Day's cell is mounted and visible in the month list, not scrolled out or clipped by its edges, so a shared layout animation can start from it. */
export function isDayCellOnScreen(day: string): boolean {
  const cell = document.querySelector(`[data-day-cell="${day}"]`);
  const scroller = cell?.closest("[data-month-scroll]");
  return !!cell && !!scroller && rectsIntersect(cell.getBoundingClientRect(), scroller.getBoundingClientRect());
}

export function DayCell({ day, isToday }: { day: string; isToday: boolean }) {
  return (
    <Link
      to="/d/$date"
      params={{ date: day }}
      aria-label={formatThaiDate(parseDay(day)!)}
      aria-current={isToday ? "date" : undefined}
      className="relative block text-left text-xs"
      style={{ aspectRatio: `1 / ${DAY_ASPECT}` }}
    >
      <motion.div
        layoutId={dayLayoutId(day)}
        data-day-cell={day}
        className={cn(
          "bg-paper text-paper-foreground absolute inset-0 p-1 shadow-[0_2px_0_color-mix(in_srgb,var(--shadow-ink)_40%,transparent)]",
          isToday && "outline-ema outline-2 -outline-offset-2",
        )}
      >
        <Thumbnail day={day} />
        <span className={cn("relative", isToday && "font-bold")}>{Number(day.slice(8))}</span>
      </motion.div>
    </Link>
  );
}
