import { useRef } from "react";

import { SessionExpired } from "@/sync/session-expired";

import { GRID_GAP, MONTH_PADDING_X } from "./layout";
import { MonthList, type MonthListHandle } from "./month-list";
import { ThemeToggle } from "./theme-toggle";
import { TodayButton } from "./today-button";

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export function MonthView({
  initialMonth,
  routeMonth,
}: {
  initialMonth: string;
  routeMonth: string | undefined;
}) {
  const listRef = useRef<MonthListHandle>(null);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-3">
        <h1 className="text-sm font-bold">Calendar Canvas</h1>
        <SessionExpired />
        <div className="flex gap-2">
          <TodayButton onJump={(m) => listRef.current?.jumpTo(m)} />
          <ThemeToggle />
        </div>
      </header>
      <div
        className="grid shrink-0 grid-cols-7 pb-1 text-center text-xs font-bold"
        style={{ gap: GRID_GAP, paddingInline: MONTH_PADDING_X }}
      >
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <MonthList ref={listRef} initialMonth={initialMonth} routeMonth={routeMonth} />
    </main>
  );
}
