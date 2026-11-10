import { memo } from "react";

import { formatThaiMonth } from "@/lib/date";

import { DayCell } from "./day-cell";
import { monthGrid } from "./grid";
import { GRID_GAP, HEADING_HEIGHT, MONTH_PADDING_X } from "./layout";

export const MonthItem = memo(function MonthItem({
  yearMonth,
  today,
}: {
  yearMonth: string;
  today: string;
}) {
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  const { weeks } = monthGrid(year, month);

  return (
    <>
      <div className="flex items-center justify-center" style={{ height: HEADING_HEIGHT }}>
        <div className="paper-shadow">
          <h2 className="paper-tag paper-grain relative flex items-center gap-3 px-10 py-2 text-base font-bold">
            <span className="border-ema absolute left-3 size-3.5 rounded-full border-[3px]" />
            {formatThaiMonth(yearMonth)}
            <span className="border-ema absolute right-3 size-3.5 rounded-full border-[3px]" />
          </h2>
        </div>
      </div>
      <div className="grid grid-cols-7" style={{ gap: GRID_GAP, paddingInline: MONTH_PADDING_X }}>
        {weeks
          .flat()
          .map((day, i) =>
            day ? (
              <DayCell key={day} day={day} isToday={day === today} />
            ) : (
              <div key={`blank-${i}`} />
            ),
          )}
      </div>
    </>
  );
});
