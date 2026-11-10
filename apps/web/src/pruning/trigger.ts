import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, type RefObject } from "react";

import type { PruneRequest, PruneResponse } from "@/api/types";
import { api } from "@/lib/api";
import { monthOfDay } from "@/lib/date";
import { dayStore } from "@/sync/day-store";
import { monthKey } from "@/sync/queries";

import type { PruneResult } from "./plan";
import type { PruningRequest } from "./protocol";
import { pruneBatches, pruneGate, verificationWidth } from "./rules";

/** Days already pruned, or being pruned, in this session. */
const started = new Set<string>();

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

async function pruneDay(
  day: string,
  paper: HTMLElement | null,
  queryClient: QueryClient,
): Promise<void> {
  const paperWidth = paper?.clientWidth ?? 0;
  if (paperWidth === 0) return console.warn(`Pruning ${day} skipped: the paper has no width`);
  const width = verificationWidth(paperWidth, window.devicePixelRatio || 1);
  const strokes = dayStore.confirmedStrokes(day);
  let submitted = false;
  try {
    const result = await planInWorker({
      strokes,
      now: Date.now(),
      protectedIds: [...dayStore.protectedIds(day)],
      width,
    });
    if ("aborted" in result) return console.warn(`Pruning ${day} aborted: ${result.aborted}`);
    for (const deleteIds of pruneBatches(result.deleteIds, strokes)) {
      submitted = true;
      await api<PruneResponse>(`/api/days/${day}/prune`, {
        method: "POST",
        body: JSON.stringify({ deleteIds } satisfies PruneRequest),
      });
    }
  } catch (error) {
    console.warn(`Pruning ${day} failed`, error);
  }
  if (submitted) await queryClient.refetchQueries({ queryKey: monthKey(monthOfDay(day)) });
}

/**
 * Prunes the Day once per session, when it holds at least 300 Strokes or 100 Erasers, in an idle moment and
 * never while a pointer is down. The verification canvas follows the width of the Drawing page's paper.
 */
export function usePruning(day: string, paperRef: RefObject<HTMLElement | null>): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (started.has(day)) return;
    const gate = () => pruneGate(dayStore.getSnapshot(day).strokes, started.has(day), down.size);
    const down = new Set<number>();
    let cancelIdle: (() => void) | undefined;
    let waiting = false;

    const schedule = () => {
      cancelIdle = whenIdle(() => {
        cancelIdle = undefined;
        const verdict = gate();
        if (verdict === "defer") waiting = true;
        if (verdict !== "run") return;
        stop();
        started.add(day);
        void pruneDay(day, paperRef.current, queryClient);
      });
    };
    const check = () => {
      if (!cancelIdle && !waiting && gate() !== "skip") schedule();
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
  }, [day, paperRef, queryClient]);
}
