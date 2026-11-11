import type { QueryClient } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";

import type { DayStore, PendingSnapshot } from "./day-store";
import { CACHE_KEY } from "./persister";

export const BUFFER_KEY = "pendingOps";

/** Puts the Pending ops saved by an earlier session into `store`. Call before anything composes a Day. Returns false when the record could not be read. */
export async function restoreBuffer(store: DayStore): Promise<boolean> {
  try {
    const saved = await get<PendingSnapshot>(BUFFER_KEY);
    if (saved) store.restore(saved);
    return true;
  } catch (error) {
    console.warn("Could not read the unsent Ops", error);
    return false;
  }
}

let holds = 0;
let onRelease = () => {};
let writeNow = () => Promise.resolve();

/** Resolves once every change made so far is in IndexedDB. Rejects when that write fails. */
export const persistNow = (): Promise<void> => writeNow();

/**
 * Throws away this device's unsynced work: the Pending ops (in memory, so the writer cannot save them back, and
 * in IndexedDB), the saved query cache, and every cached query and mutation. Used when the server says the User is Blocked.
 */
export async function discardLocalData(queryClient: QueryClient, store: DayStore): Promise<void> {
  store.discardPending();
  queryClient.clear();
  await writeNow().catch(() => {});
  await Promise.all([del(BUFFER_KEY), del(CACHE_KEY)]);
}

/**
 * Keeps settled Ops in the saved record until the returned function runs. A settled Op leaves the buffer only
 * once the month cache holding its Stroke is saved, so a restart between the two never loses the Stroke.
 */
export function holdBuffer(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds === 0) onRelease();
  };
}

const union = <T>(a: readonly T[], b: readonly T[], key: (item: T) => unknown): T[] => {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((item) => !seen.has(key(item)))];
};

/** Writes the Pending ops to IndexedDB whenever the set changes. Start it after `restoreBuffer`. Returns the stop function. */
export function persistBuffer(store: DayStore): () => void {
  const signatureOf = ({ ops }: PendingSnapshot) => ops.map((op) => op.localSeq).join();
  let written = store.snapshotPending();
  let queue = Promise.resolve();
  const write = (): Promise<void> => {
    const run = queue.then(async () => {
      const now = store.snapshotPending();
      const next =
        holds === 0
          ? now
          : {
              ops: union(written.ops, now.ops, (op) => op.localSeq).sort(
                (a, b) => a.localSeq - b.localSeq,
              ),
              strokes: union(written.strokes, now.strokes, (stroke) => stroke.id),
            };
      if (signatureOf(next) === signatureOf(written)) return;
      await set(BUFFER_KEY, next);
      written = next;
    });
    queue = run.catch(() => {});
    return run;
  };
  const writeInBackground = () =>
    void write().catch((error) => console.warn("Could not save the unsent Ops", error));
  onRelease = writeInBackground;
  writeNow = write;
  const unsubscribe = store.subscribe(writeInBackground);
  return () => {
    unsubscribe();
    onRelease = () => {};
    writeNow = () => Promise.resolve();
  };
}
