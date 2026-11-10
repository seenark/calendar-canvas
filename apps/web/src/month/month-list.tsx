import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { monthIndex, toDayKey, yearMonthOfIndex } from "@/lib/date";

import { HEADING_HEIGHT, MONTH_RANGE, monthItemHeight } from "./layout";
import { MonthItem } from "./month-item";

const COUNT = 2 * MONTH_RANGE + 1;
const URL_DEBOUNCE_MS = 300;

/**
 * Month list that opens on `initialMonth`. `routeMonth` is the `$yearMonth` in the URL, or
 * undefined while another route (a Day) is open over the list.
 */
export function MonthList({
  initialMonth,
  routeMonth,
}: {
  initialMonth: string;
  routeMonth: string | undefined;
}) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [base] = useState(() => monthIndex(initialMonth));
  const visibleMonth = useRef(initialMonth);
  const reportedMonth = useRef(initialMonth);
  const urlTimer = useRef<number>(undefined);
  const today = toDayKey(new Date());

  const yearMonthAt = (index: number) => yearMonthOfIndex(base + index - MONTH_RANGE);
  const indexOf = (yearMonth: string) =>
    Math.min(COUNT - 1, Math.max(0, monthIndex(yearMonth) - base + MONTH_RANGE));

  const virtualizer = useVirtualizer({
    count: COUNT,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => monthItemHeight(width, yearMonthAt(index)),
    overscan: 2,
  });

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (width === 0) return;
    virtualizer.measure();
    virtualizer.scrollToIndex(indexOf(visibleMonth.current), { align: "start" });
  }, [width]);

  useEffect(() => {
    if (routeMonth === undefined) {
      window.clearTimeout(urlTimer.current);
      return;
    }
    if (routeMonth === reportedMonth.current) return;
    reportedMonth.current = routeMonth;
    visibleMonth.current = routeMonth;
    window.clearTimeout(urlTimer.current);
    virtualizer.scrollToIndex(indexOf(routeMonth), { align: "start" });
  }, [routeMonth]);

  useEffect(() => () => window.clearTimeout(urlTimer.current), []);

  const onScroll = () => {
    const top = scrollRef.current!.scrollTop + HEADING_HEIGHT;
    const item = virtualizer.getVirtualItems().find((v) => v.end > top);
    if (!item) return;
    const yearMonth = yearMonthAt(item.index);
    if (yearMonth === visibleMonth.current) return;
    visibleMonth.current = yearMonth;
    if (routeMonth === undefined) return;
    window.clearTimeout(urlTimer.current);
    urlTimer.current = window.setTimeout(() => {
      if (yearMonth === reportedMonth.current) return;
      reportedMonth.current = yearMonth;
      void navigate({ to: "/m/$yearMonth", params: { yearMonth }, replace: true });
    }, URL_DEBOUNCE_MS);
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {width > 0 &&
          virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              className="absolute top-0 left-0 w-full"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              <MonthItem yearMonth={yearMonthAt(item.index)} today={today} />
            </div>
          ))}
      </div>
    </div>
  );
}
