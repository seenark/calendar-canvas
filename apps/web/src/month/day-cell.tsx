import { Link } from "@tanstack/react-router";

import { cn } from "@calendar-canvas/ui/lib/utils";

import { DAY_ASPECT } from "@/ink/constants";
import { formatThaiDate, parseDay } from "@/lib/date";

export function DayCell({ day, isToday }: { day: string; isToday: boolean }) {
  return (
    <Link
      to="/d/$date"
      params={{ date: day }}
      aria-label={formatThaiDate(parseDay(day)!)}
      aria-current={isToday ? "date" : undefined}
      className={cn(
        "bg-paper text-paper-foreground relative block p-1 text-left text-xs shadow-[0_2px_0_color-mix(in_srgb,var(--shadow-ink)_40%,transparent)]",
        isToday && "outline-ema outline-2 -outline-offset-2",
      )}
      style={{ aspectRatio: `1 / ${DAY_ASPECT}` }}
    >
      <span data-slot="thumbnail" className="pointer-events-none absolute inset-0" />
      <span className={cn("relative", isToday && "font-bold")}>{Number(day.slice(8))}</span>
    </Link>
  );
}
