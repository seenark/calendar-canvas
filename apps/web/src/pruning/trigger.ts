import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { PruneRequest, PruneResponse } from "@/api/types";
import { DAY_ASPECT } from "@/ink/constants";
import { api } from "@/lib/api";
import { monthOfDay } from "@/lib/date";
import { dayStore } from "@/sync/day-store";
import { monthKey } from "@/sync/queries";

import type { PruneResult } from "./plan";
import type { PruningRequest } from "./protocol";

const MIN_STROKES = 300;
const MIN_ERASERS = 100;

/** Days already pruned, or being pruned, in this session. */
const started = new Set<string>();

function isBusy(day: string): boolean {
  const { strokes } = dayStore.getSnapshot(day);
  return (
    strokes.length >= MIN_STROKES || strokes.filter((s) => s.kind === "eraser").length >= MIN_ERASERS
  );
}

/** `requestIdleCallback` is missing in Safari, which this app targets. */
function whenIdle(task: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const handle = requestIdleCallback(task);
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, 1000);
  return () => clearTimeout(handle);
}

function planInWorker(request: PruningRequest): Promise<PruneResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./prune.worker.ts", import.meta.url), { type: "module" });
    const done = (result: PruneResult) => {
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = ({ data }: MessageEvent<PruneResult>) => done(data);
    worker.onerror = (e) => done({ aborted: e.message });
    worker.postMessage(request);
  });
}

async function pruneDay(day: string, queryClient: QueryClient): Promise<void> {
  const width = Math.round(
    Math.min(window.innerWidth, window.innerHeight / DAY_ASPECT) * window.devicePixelRatio,
  );
  try {
    const result = await planInWorker({
      strokes: dayStore.confirmedStrokes(day),
      now: Date.now(),
      protectedIds: [...dayStore.protectedIds(day)],
      width,
    });
    if ("aborted" in result) return console.warn(`Pruning ${day} aborted: ${result.aborted}`);
    if (result.deleteIds.length === 0) return;
    await api<PruneResponse>(`/api/days/${day}/prune`, {
      method: "POST",
      body: JSON.stringify({ deleteIds: result.deleteIds } satisfies PruneRequest),
    });
    await queryClient.refetchQueries({ queryKey: monthKey(monthOfDay(day)) });
  } catch (error) {
    console.warn(`Pruning ${day} failed`, error);
  }
}

/**
 * Prunes the Day once per session, when it holds at least 300 Strokes or 100 Erasers, in an idle moment and
 * never while a pointer is down.
 */
export function usePruning(day: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (started.has(day)) return;
    const down = new Set<number>();
    let cancelIdle: (() => void) | undefined;
    let waiting = false;

    const schedule = () => {
      cancelIdle = whenIdle(() => {
        cancelIdle = undefined;
        if (down.size > 0) {
          waiting = true;
          return;
        }
        stop();
        started.add(day);
        void pruneDay(day, queryClient);
      });
    };
    const check = () => {
      if (!cancelIdle && !waiting && isBusy(day)) schedule();
    };
    const onDown = (e: PointerEvent) => down.add(e.pointerId);
    const onUp = (e: PointerEvent) => {
      down.delete(e.pointerId);
      if (waiting && down.size === 0) {
        waiting = false;
        schedule();
      }
    };
    const unsubscribe = dayStore.subscribe(check);
    const stop = () => {
      unsubscribe();
      cancelIdle?.();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    check();
    return stop;
  }, [day, queryClient]);
}
