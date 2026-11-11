import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { monthIndex, yearMonthOfIndex } from "@/lib/date";
import { useToday } from "@/lib/use-today";
import { useMonths } from "@/sync/queries";

import { rememberMonth } from "./last-month";
import {
  growAfter,
  growBefore,
  HEADING_HEIGHT,
  monthItemHeight,
  type MonthRange,
  rangeAround,
  rangeContains,
} from "./layout";
import { MonthItem } from "./month-item";

const URL_DEBOUNCE_MS = 300;

/** `align` is the month index to put at the top once the range commits; null keeps the scroll as is. */
type ListState = { range: MonthRange; align: number | null };

export type MonthListHandle = { jumpTo(yearMonth: string): void };

function listAround(index: number): ListState {
  return { range: rangeAround(index), align: index };
}

/**
 * Month list that opens on `initialMonth` and grows one month at a time as the edge months
 * scroll into view. `routeMonth` is the `$yearMonth` in the URL, or undefined while another
 * route (a Day) is open over the list.
 */
export function MonthList({
  initialMonth,
  routeMonth,
  ref,
}: {
  initialMonth: string;
  routeMonth: string | undefined;
  ref: Ref<MonthListHandle>;
}) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [list, setList] = useState(() => listAround(monthIndex(initialMonth)));
  const appliedList = useRef<ListState | null>(null);
  const visibleMonth = useRef(initialMonth);
  const reportedMonth = useRef(initialMonth);
  const dayOpen = useRef(false);
  const urlTimer = useRef<number>(undefined);
  const today = useToday();

  const { range } = list;
  const count = range.last - range.first + 1;
  const yearMonthAt = (index: number) => yearMonthOfIndex(range.first + index);
  const indexOf = (yearMonth: string) =>
    Math.min(count - 1, Math.max(0, monthIndex(yearMonth) - range.first));

  const publish = (yearMonth: string) => {
    reportedMonth.current = yearMonth;
    void navigate({ to: "/m/$yearMonth", params: { yearMonth }, replace: true });
  };

  // `width` is a dependency so a width change rebuilds the measurements that estimateSize feeds.
  // `anchorTo: "end"` makes the virtualizer keep the month being read in place when a month is
  // prepended, deferring the write on iOS while a gesture is in motion.
  const getItemKey = useCallback((index: number) => range.first + index, [range.first, width]);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: (index) => monthItemHeight(width, yearMonthAt(index)),
    overscan: 2,
    anchorTo: "end",
  });

  const firstVisible = virtualizer.range?.startIndex ?? indexOf(initialMonth);
  const lastVisible = virtualizer.range?.endIndex ?? firstVisible;
  useMonths(
    Array.from({ length: lastVisible - firstVisible + 1 }, (_, i) => yearMonthAt(firstVisible + i)),
  );

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
    const fresh = appliedList.current !== list;
    appliedList.current = list;
    const align = fresh ? list.align : monthIndex(visibleMonth.current);
    if (align !== null) virtualizer.scrollToIndex(align - range.first, { align: "start" });
  }, [list, width]);

  useLayoutEffect(() => {
    if (width === 0) return;
    const el = scrollRef.current!;
    const scrollTop = virtualizer.scrollOffset ?? 0;
    // A scroll command or a held anchor correction is written to the element before the
    // virtualizer reads it back, and growing meanwhile prepends against a position it is about
    // to replace. The read-back re-renders, so decide then.
    if (Math.abs(el.scrollTop - scrollTop) > 1) return;
    // Month heights are fractional and WebKit floors scrollTop, so a sliver under 1px is not on screen.
    const before = growBefore(range);
    if (scrollTop + 1 < monthItemHeight(width, yearMonthAt(0)) && before !== range) {
      setList({ range: before, align: null });
      return;
    }
    const lastTop = virtualizer.getTotalSize() - monthItemHeight(width, yearMonthAt(count - 1));
    const after = growAfter(range);
    if (scrollTop + el.clientHeight > lastTop + 1 && after !== range) {
      setList({ range: after, align: null });
    }
  });

  useEffect(() => {
    if (routeMonth === undefined) {
      window.clearTimeout(urlTimer.current);
      dayOpen.current = true;
      return;
    }
    rememberMonth(routeMonth);
    const returningFromDay = dayOpen.current;
    dayOpen.current = false;
    if (routeMonth === reportedMonth.current) {
      if (returningFromDay && visibleMonth.current !== routeMonth) publish(visibleMonth.current);
      return;
    }
    reportedMonth.current = routeMonth;
    visibleMonth.current = routeMonth;
    window.clearTimeout(urlTimer.current);
    const target = monthIndex(routeMonth);
    if (rangeContains(range, target)) {
      virtualizer.scrollToIndex(target - range.first, { align: "start" });
    } else {
      setList(listAround(target));
    }
  }, [routeMonth]);

  useEffect(() => () => window.clearTimeout(urlTimer.current), []);

  useImperativeHandle(ref, () => ({
    jumpTo(yearMonth) {
      visibleMonth.current = yearMonth;
      window.clearTimeout(urlTimer.current);
      setList(listAround(monthIndex(yearMonth)));
      if (routeMonth !== undefined && yearMonth !== reportedMonth.current) publish(yearMonth);
    },
  }));

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
      if (yearMonth !== reportedMonth.current) publish(yearMonth);
    }, URL_DEBOUNCE_MS);
  };

  return (
    <div
      ref={scrollRef}
      data-month-scroll
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
    >
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
