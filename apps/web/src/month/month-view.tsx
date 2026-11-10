import { SessionExpired } from "@/sync/session-expired";

import { GRID_GAP, MONTH_PADDING_X } from "./layout";
import { MonthList } from "./month-list";
import { ThemeToggle } from "./theme-toggle";

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export function MonthView({
  initialMonth,
  routeMonth,
}: {
  initialMonth: string;
  routeMonth: string | undefined;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-3">
        <h1 className="text-sm font-bold">Calendar Canvas</h1>
        <SessionExpired />
        <ThemeToggle />
      </header>
      <div
        className="grid shrink-0 grid-cols-7 pb-1 text-center text-xs font-bold"
        style={{ gap: GRID_GAP, paddingInline: MONTH_PADDING_X }}
      >
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <MonthList initialMonth={initialMonth} routeMonth={routeMonth} />
    </main>
  );
}
