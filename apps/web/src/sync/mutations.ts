import { MutationObserver, type MutationOptions, type QueryClient } from "@tanstack/react-query";

import type { Op as WireOp, OpsRequest, OpsResponse } from "@/api/types";
import { bytesToBase64 } from "@/ink/base64";
import { encodePoints } from "@/ink/codec";
import { api } from "@/lib/api";
import { monthOfDay } from "@/lib/date";

import type { DayStore } from "./day-store";
import type { SentOp } from "./ops";
import { monthKey, type MonthStrokes } from "./queries";

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

/** Defaults for `['strokeOps']`: batches of one scope run one at a time, in order. */
export function strokeOpsDefaults(
  queryClient: QueryClient,
  store: DayStore,
): MutationOptions<OpsResponse, Error, StrokeOpsVariables> {
  return {
    scope: { id: "strokeOps" },
    mutationFn: sendBatch,
    onSuccess: async (response, { ops }) => {
      const months = [...new Set(ops.map((op) => monthOfDay(op.day)))];
      // A refetch that started before this batch committed would overwrite the cache without its Strokes.
      await Promise.all(
        months.map((month) =>
          queryClient.cancelQueries({
            queryKey: monthKey(month),
            exact: true,
            predicate: (q) => q.state.data !== undefined,
          }),
        ),
      );
      const settled = store.settle(ops, response.results, Date.now());
      for (const month of months)
        queryClient.setQueryData<MonthStrokes>(
          monthKey(month),
          (old) =>
            old && {
              ...old,
              ...Object.fromEntries([...settled].filter(([day]) => monthOfDay(day) === month)),
            },
        );
    },
    onError: (_error, { ops }) => store.release(ops),
  };
}

/** Sends every Pending op that is not in flight. */
export function sendOps(queryClient: QueryClient, store: DayStore): void {
  const ops = store.takeUnsent();
  if (ops.length === 0) return;
  new MutationObserver<OpsResponse, Error, StrokeOpsVariables>(queryClient, {
    mutationKey: STROKE_OPS_KEY,
  })
    .mutate({ ops })
    .catch(() => undefined);
}
