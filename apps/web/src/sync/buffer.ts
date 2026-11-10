import { get, set } from "idb-keyval";

import type { DayStore, PendingSnapshot } from "./day-store";

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
  const write = () => {
    queue = queue.then(() => {
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
      written = next;
      return set(BUFFER_KEY, next).catch((error) =>
        console.warn("Could not save the unsent Ops", error),
      );
    });
  };
  onRelease = write;
  const unsubscribe = store.subscribe(write);
  return () => {
    unsubscribe();
    onRelease = () => {};
  };
}
