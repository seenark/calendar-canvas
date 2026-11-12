import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { monthOfDay } from "@/lib/date";
import { dayStore, type DaySnapshot } from "@/sync/day-store";
import { sharedMonthKey, type MonthStrokes } from "@/sync/queries";

/** Where a calendar's Strokes come from. `dayStore` fits: `useSyncExternalStore(source.subscribe, () => source.getSnapshot(day))`. */
export type DaySource = {
  subscribe(listener: () => void): () => void;
  getSnapshot(day: string): Pick<DaySnapshot, "revision" | "strokes">;
};

type Snapshot = ReturnType<DaySource["getSnapshot"]>;

const EMPTY: Snapshot = { revision: 0, strokes: [] };
let nextRevision = 1;
/** One snapshot per Day array, so a refetch that changed nothing keeps its identity and its revision. */
const snapshots = new WeakMap<object, Snapshot>();

/** Read-only view of one Owner's cached months. Never writes, so a Viewer's data cannot reach the User's own `dayStore`. */
export function createSharedSource(queryClient: QueryClient, ownerId: string): DaySource {
  return {
    subscribe: (listener) =>
      queryClient.getQueryCache().subscribe(({ query }) => {
        if (query.queryKey[0] === "sharedMonth" && query.queryKey[1] === ownerId) listener();
      }),
    getSnapshot(day) {
      const strokes = queryClient.getQueryData<MonthStrokes>(
        sharedMonthKey(ownerId, monthOfDay(day)),
      )?.[day];
      if (!strokes?.length) return EMPTY;
      let snapshot = snapshots.get(strokes);
      if (!snapshot) {
        snapshot = { revision: nextRevision++, strokes };
        snapshots.set(strokes, snapshot);
      }
      return snapshot;
    },
  };
}

/** `ownerId` is null for the User's own calendar. */
export type Calendar = { ownerId: string | null; source: DaySource };

const OWN: Calendar = { ownerId: null, source: dayStore };
const CalendarContext = createContext<Calendar>(OWN);

export const useCalendar = (): Calendar => useContext(CalendarContext);

export function CalendarProvider({
  ownerId,
  children,
}: {
  ownerId: string | null;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const value = useMemo<Calendar>(
    () => (ownerId === null ? OWN : { ownerId, source: createSharedSource(queryClient, ownerId) }),
    [queryClient, ownerId],
  );
  return <CalendarContext value={value}>{children}</CalendarContext>;
}
