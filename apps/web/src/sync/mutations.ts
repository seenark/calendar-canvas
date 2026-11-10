import type { MutationOptions, QueryClient } from "@tanstack/react-query";

import type { Op as WireOp, OpsRequest, OpsResponse } from "@/api/types";
import { bytesToBase64 } from "@/ink/base64";
import { encodePoints } from "@/ink/codec";
import { api } from "@/lib/api";
import { monthOfDay } from "@/lib/date";

import { BATCH_LIMITS, splitBatches } from "./batches";
import { holdBuffer } from "./buffer";
import type { DayStore } from "./day-store";
import type { SentOp } from "./ops";
import { monthKey, monthQuery, type MonthStrokes } from "./queries";
import { shouldRetry, retryDelay } from "./retry";

export const STROKE_OPS_KEY = ["strokeOps"] as const;

export type StrokeOpsVariables = { ops: SentOp[] };

export function toWireOp(op: SentOp): WireOp {
  if (op.op !== "add") return { op: op.op, id: op.id };
  const { id, day, kind, color, size, points, hasPressure, bbox, createdAt } = op.stroke;
  return {
    op: "add",
    stroke: {
      id,
      day,
      kind,
      color,
      size,
      points: bytesToBase64(encodePoints(points, { hasPressure })),
      bbox,
      createdAt,
    },
  };
}

/** The one seam to the server: POSTs a batch and returns the per-Op results. */
export const sendBatch = ({ ops }: StrokeOpsVariables) =>
  api<OpsResponse>("/api/strokes/ops", {
    method: "POST",
    body: JSON.stringify({ ops: ops.map(toWireOp) } satisfies OpsRequest),
  });

/**
 * Defaults for `['strokeOps']`. `sendOps` keeps at most one batch in flight, so `scope` is a second guard.
 * `saveCache` stores the query cache and resolves when it is durable; settled Ops stay in the saved buffer until then.
 */
export function strokeOpsDefaults(
  queryClient: QueryClient,
  store: DayStore,
  saveCache: () => Promise<void>,
): MutationOptions<OpsResponse, Error, StrokeOpsVariables> {
  return {
    scope: { id: "strokeOps" },
    networkMode: "online",
    retry: shouldRetry,
    retryDelay,
    mutationFn: sendBatch,
    onSuccess: async (response, { ops }) => {
      const months = [...new Set(ops.map((op) => monthOfDay(op.day)))];
      // A GET that started before this batch committed would overwrite the cache without its Strokes.
      const stale = months.filter((month) => {
        const query = queryClient.getQueryCache().find({ queryKey: monthKey(month), exact: true });
        return query && (query.state.data === undefined || query.state.fetchStatus === "fetching");
      });
      await Promise.all(
        stale.map((month) => queryClient.cancelQueries({ queryKey: monthKey(month), exact: true })),
      );
      const release = holdBuffer();
      const loads: Promise<unknown>[] = [];
      try {
        const settled = store.settle(ops, response.results, Date.now());
        for (const month of months) {
          const key = monthKey(month);
          // Without cached data there is nothing to merge into. A fetch started here reads after the commit,
          // and `prefetchQuery` also covers a month nothing observes.
          if (queryClient.getQueryData(key) === undefined) {
            if (stale.includes(month)) loads.push(queryClient.prefetchQuery(monthQuery(month)));
            continue;
          }
          queryClient.setQueryData<MonthStrokes>(key, (old) => ({
            ...old,
            ...Object.fromEntries([...settled].filter(([day]) => monthOfDay(day) === month)),
          }));
        }
      } finally {
        void Promise.all(loads)
          .then(saveCache)
          .catch((error) => console.warn("Could not save the month cache", error))
          .finally(release);
      }
    },
    onError: (_error, { ops }) => store.release(ops),
  };
}

/**
 * Single-flight sender. A batch (at most `BATCH_LIMITS`) reads the unsent Ops when it starts. On success the next
 * batch starts at once; on failure its Ops return to the front of the unsent set and nothing is sent until the
 * next trigger.
 */
export function sendOps(queryClient: QueryClient, store: DayStore): void {
  if (queryClient.isMutating({ mutationKey: STROKE_OPS_KEY }) > 0) return;
  const [ops = [], ...rest] = splitBatches(store.takeUnsent(), BATCH_LIMITS, toWireOp);
  store.release(rest.flat());
  if (ops.length === 0) return;
  // Built without an observer, so the mutation is garbage collected after it settles.
  queryClient
    .getMutationCache()
    .build<OpsResponse, Error, StrokeOpsVariables, unknown>(queryClient, {
      mutationKey: STROKE_OPS_KEY,
    })
    .execute({ ops })
    .then(
      () => sendOps(queryClient, store),
      () => undefined,
    );
}

/**
 * Adopts `strokeOps` mutations restored from persistence: their Ops join the Overlay as in flight, so they are
 * neither shown twice nor sent twice. Nothing chains after a restored mutation, so `sendOps` runs when one succeeds;
 * a failed batch waits for the next trigger, as in `sendOps`.
 * The buffer is written on every change and the query cache only throttled, so a mutation whose Ops the restored
 * buffer no longer holds already settled; it is dropped, not resent. When the buffer could not be read
 * (`bufferRestored` false) that rule is off, because the mutation may be the only copy.
 */
export function adoptRestoredStrokeOps(
  queryClient: QueryClient,
  store: DayStore,
  bufferRestored: boolean,
): void {
  const cache = queryClient.getMutationCache();
  const restored = new Set<number>();
  const buffered = new Set(store.snapshotPending().ops.map((op) => op.localSeq));
  for (const mutation of cache.findAll({ mutationKey: STROKE_OPS_KEY })) {
    if (mutation.state.status !== "pending") continue;
    const { ops } = mutation.state.variables as StrokeOpsVariables;
    if (bufferRestored && !ops.every((op) => buffered.has(op.localSeq))) {
      cache.remove(mutation);
      continue;
    }
    store.restore({ ops, strokes: [] }, true);
    restored.add(mutation.mutationId);
  }
  if (restored.size === 0) return;
  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== "updated" || !restored.has(event.mutation.mutationId)) return;
    const { status } = event.mutation.state;
    if (status !== "success" && status !== "error") return;
    restored.delete(event.mutation.mutationId);
    if (restored.size === 0) unsubscribe();
    if (status === "success") sendOps(queryClient, store);
  });
}
