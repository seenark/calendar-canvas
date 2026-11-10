import { get, set } from "idb-keyval";

import type { DayStore, PendingSnapshot } from "./day-store";

export const BUFFER_KEY = "pendingOps";

/** Puts the Pending ops saved by an earlier session into `store`. Call before anything composes a Day. */
export async function restoreBuffer(store: DayStore): Promise<void> {
  try {
    const saved = await get<PendingSnapshot>(BUFFER_KEY);
    if (saved) store.restore(saved);
  } catch (error) {
    console.warn("Could not read the unsent Ops", error);
  }
}

/** Writes the Pending ops to IndexedDB whenever the set changes. Start it after `restoreBuffer`. Returns the stop function. */
export function persistBuffer(store: DayStore): () => void {
  let written = "";
  return store.subscribe(() => {
    const snapshot = store.snapshotPending();
    const signature = snapshot.ops.map((op) => op.localSeq).join();
    if (signature === written) return;
    written = signature;
    set(BUFFER_KEY, snapshot).catch((error) =>
      console.warn("Could not save the unsent Ops", error),
    );
  });
}
