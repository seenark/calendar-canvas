import type { DayStore } from "./day-store";

export const IDLE_MS = 1500;
export const MAX_BUFFERED_OPS = 50;

/** Calls `flush` when no Op arrived for `IDLE_MS`, when `MAX_BUFFERED_OPS` Ops arrived since the last flush, or on `now()`. */
export function createFlusher(flush: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let count = 0;
  const now = () => {
    clearTimeout(timer);
    timer = undefined;
    count = 0;
    flush();
  };
  const onOp = () => {
    clearTimeout(timer);
    if (++count >= MAX_BUFFERED_OPS) return now();
    timer = setTimeout(now, IDLE_MS);
  };
  return { onOp, now };
}

/** Flushes on idle, on 50 buffered Ops, when the page is hidden and on `pagehide`. Returns the stop function. */
export function startFlushing(store: DayStore, flush: () => void): () => void {
  const flusher = createFlusher(flush);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flusher.now();
  };
  const unsubscribe = store.subscribeOps(flusher.onOp);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flusher.now);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flusher.now);
  };
}
