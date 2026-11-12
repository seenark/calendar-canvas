import { onlineManager, useQueryClient } from "@tanstack/react-query";
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
import { useCalendar } from "@/share/calendar";
import { monthLink } from "@/share/links";
import { monthQueryFor, useMonths } from "@/sync/queries";

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
import { PullIndicator } from "./pull-indicator";
import { usePullToLoad } from "./use-pull-to-load";

const URL_DEBOUNCE_MS = 300;

/** `align` is the month index to put at the top once the range commits; null keeps the scroll as is. */
type ListState = { range: MonthRange; align: number | null };

export type MonthListHandle = { jumpTo(yearMonth: string): void };

function listAround(index: number): ListState {
  return { range: rangeAround(index), align: index };
}

/**
 * Month list that opens on `initialMonth` with `RANGE_RADIUS` months on each side. A pull past
 * either end adds `PULL_MONTHS` more once their Strokes are fetched. `routeMonth` is the
 * `$yearMonth` in the URL, or undefined while another route (a Day) is open over the list.
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
  const queryClient = useQueryClient();
  const { ownerId } = useCalendar();
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

  const publish = (yearMonth: string) => {
    reportedMonth.current = yearMonth;
    void navigate({ ...monthLink(ownerId, yearMonth), replace: true });
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

  const rangeLoading = useMonths(
    Array.from({ length: count }, (_, i) => yearMonthAt(i)),
    ownerId,
  );

  const pull = usePullToLoad(scrollRef, {
    canLoad: (edge) => (edge === "top" ? growBefore(range) : growAfter(range)) !== range,
    async load(edge) {
      const grown = edge === "top" ? growBefore(range) : growAfter(range);
      const [from, to] =
        edge === "top" ? [grown.first, range.first - 1] : [range.last + 1, grown.last];
      // Offline fails at once instead of pausing; `ensureQueryData` would otherwise join a paused prefetch.
      if (!onlineManager.isOnline()) throw new Error("offline");
      await Promise.all(
        Array.from({ length: to - from + 1 }, (_, i) =>
          queryClient.ensureQueryData({
            ...monthQueryFor(ownerId, yearMonthOfIndex(from + i)),
            networkMode: "always",
            retry: false,
          }),
        ),
      );
      // A jump meanwhile replaced the list; these months no longer border it.
      setList((current) => (current === list ? { range: grown, align: null } : current));
    },
  });

  // virtual-core ends an iOS gesture on the scroller's own touchend. A touched Day cell that
  // unmounts mid-gesture still gets the touchend but it never bubbles to the scroller, so relay it.
  useEffect(() => {
    const el = scrollRef.current!;
    const onStart = (event: TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const done = new AbortController();
      const relay = (end: Event) => {
        done.abort();
        if (!el.contains(target)) el.dispatchEvent(new Event(end.type));
      };
      target.addEventListener("touchend", relay, { signal: done.signal });
      target.addEventListener("touchcancel", relay, { signal: done.signal });
    };
    el.addEventListener("touchstart", onStart, { capture: true, passive: true });
    return () => el.removeEventListener("touchstart", onStart, { capture: true });
  }, []);

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
      pull.reset();
      setList(listAround(target));
    }
  }, [routeMonth]);

  // Another calendar's Strokes are fetched per Owner, so it gets its own range around the month being read.
  const shownOwner = useRef(ownerId);
  useEffect(() => {
    if (shownOwner.current === ownerId) return;
    shownOwner.current = ownerId;
    pull.reset();
    setList(listAround(monthIndex(visibleMonth.current)));
  }, [ownerId]);

  useEffect(() => () => window.clearTimeout(urlTimer.current), []);

  useImperativeHandle(ref, () => ({
    jumpTo(yearMonth) {
      visibleMonth.current = yearMonth;
      window.clearTimeout(urlTimer.current);
      pull.reset();
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-month-scroll
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-none"
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
      <PullIndicator state={pull.state} rangeLoading={rangeLoading} />
    </div>
  );
}
