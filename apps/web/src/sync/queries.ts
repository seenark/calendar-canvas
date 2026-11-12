import {
  queryOptions,
  useQueries,
  useQueryClient,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import { getDefaultStore } from "jotai/vanilla";
import { useEffect } from "react";

import type { MonthResponse } from "@/api/types";
import { base64ToBytes } from "@/ink/base64";
import { decodePoints } from "@/ink/codec";
import { ApiError, api } from "@/lib/api";
import { monthIndex, yearMonthOfIndex } from "@/lib/date";
import { needsAuthAtom } from "@/state/auth";

import type { DayStore } from "./day-store";
import type { ConfirmedStroke } from "./ops";
import { shouldRetry } from "./retry";

/** A month's confirmed Strokes by Day key, each Day in ascending `seq`. Plain data, so it survives JSON. */
export type MonthStrokes = Record<string, ConfirmedStroke[]>;

export const monthKey = (yearMonth: string) => ["month", yearMonth] as const;

export function decodeMonth({ strokes }: MonthResponse): MonthStrokes {
  const days: MonthStrokes = {};
  for (const w of strokes) {
    try {
      const { points, hasPressure } = decodePoints(base64ToBytes(w.points));
      (days[w.day] ??= []).push({
        id: w.id,
        day: w.day,
        kind: w.kind,
        color: w.color,
        size: w.size,
        points,
        hasPressure,
        bbox: w.bbox,
        createdAt: w.createdAt,
        seq: w.seq,
        receivedAt: w.receivedAt,
      });
    } catch (error) {
      console.warn(`Skipping undecodable Stroke ${w.id}`, error);
    }
  }
  for (const list of Object.values(days)) list.sort((a, b) => a.seq - b.seq);
  return days;
}

/** An Owner's month as a Viewer sees it. Never fed to the `DayStore`: it holds the User's own Strokes only. */
export const sharedMonthKey = (ownerId: string, yearMonth: string) =>
  ["sharedMonth", ownerId, yearMonth] as const;

const monthFetch = (path: string) => async () => {
  try {
    return decodeMonth(await api<MonthResponse>(path));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      getDefaultStore().set(needsAuthAtom, true);
    throw error;
  }
};

/** A month of the User's own calendar (`ownerId` null) or of an Owner's. */
export const monthQueryFor = (ownerId: string | null, yearMonth: string) =>
  queryOptions({
    queryKey: ownerId === null ? monthKey(yearMonth) : sharedMonthKey(ownerId, yearMonth),
    queryFn: monthFetch(
      ownerId === null ? `/api/months/${yearMonth}` : `/api/users/${ownerId}/months/${yearMonth}`,
    ),
    retry: (failureCount, error) => failureCount < 3 && shouldRetry(failureCount, error),
  });

export const monthQuery = (yearMonth: string) => monthQueryFor(null, yearMonth);

/**
 * Observes `months` of the User's own calendar, or of `ownerId`'s, and prefetches the month on each side of them.
 * Returns whether any of `months` is fetching with no data to show yet.
 */
export function useMonths(months: readonly string[], ownerId: string | null = null): boolean {
  const queryClient = useQueryClient();
  const results = useQueries({
    queries: months.map((yearMonth) => monthQueryFor(ownerId, yearMonth)),
  });
  const first = months[0];
  const last = months[months.length - 1];
  useEffect(() => {
    if (first === undefined || last === undefined) return;
    for (const index of [monthIndex(first) - 1, monthIndex(last) + 1])
      void queryClient.prefetchQuery(monthQueryFor(ownerId, yearMonthOfIndex(index)));
  }, [queryClient, first, last, ownerId]);
  return results.some((result) => result.isLoading);
}

/**
 * Feeds every `['month', ym]` result into `store` as the confirmed layer, whoever fetched or wrote it. A Day
 * that vanished from a month is cleared. Returns the unsubscribe function.
 */
export function bindMonthsToStore(queryClient: QueryClient, store: DayStore): () => void {
  const fed = new Map<string, MonthStrokes>();
  const feed = (query: Query) => {
    if (query.queryKey[0] !== "month") return;
    const yearMonth = query.queryKey[1] as string;
    const data = query.state.data as MonthStrokes | undefined;
    const prev = fed.get(yearMonth);
    if (!data || data === prev) return;
    fed.set(yearMonth, data);
    for (const day of new Set([...Object.keys(prev ?? {}), ...Object.keys(data)]))
      store.setConfirmed(day, data[day] ?? []);
  };
  const cache = queryClient.getQueryCache();
  cache.getAll().forEach(feed);
  return cache.subscribe((event) => {
    if (event.type === "added" || event.type === "updated") feed(event.query);
  });
}
