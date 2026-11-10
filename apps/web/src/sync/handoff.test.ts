import { QueryClient, hydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const disk = vi.hoisted(() => new Map<string, unknown>());
const cacheWrite = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => disk.get(key),
  del: async (key: string) => void disk.delete(key),
  set: async (key: string, value: unknown) => {
    if (key === "REACT_QUERY_OFFLINE_CACHE") await cacheWrite.gate;
    disk.set(key, value);
  },
}));

import { BUFFER_KEY, persistBuffer, restoreBuffer } from "./buffer";
import { DayStore } from "./day-store";
import { confirmed, stroke } from "./fixtures";
import { STROKE_OPS_KEY, sendOps, strokeOpsDefaults } from "./mutations";
import { saveQueryCacheNow } from "./persister";
import { bindMonthsToStore, monthKey, type MonthStrokes } from "./queries";

const DAY = "2026-11-10";
const MONTH = "2026-11";
const CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  disk.clear();
  cacheWrite.gate = null;
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A cold start offline: both durable stores are read, nothing else survives. */
async function reopen() {
  const queryClient = new QueryClient();
  const store = new DayStore();
  bindMonthsToStore(queryClient, store);
  const cache = disk.get(CACHE_KEY);
  if (cache) hydrate(queryClient, JSON.parse(cache as string).clientState);
  await restoreBuffer(store);
  return store.getSnapshot(DAY).strokes.map((s) => s.id);
}

describe("settling an Op", () => {
  it("keeps the Op in the saved buffer until the month cache holding its Stroke is saved", async () => {
    const queryClient = new QueryClient();
    const store = new DayStore();
    queryClient.setMutationDefaults(
      STROKE_OPS_KEY,
      strokeOpsDefaults(queryClient, store, () => saveQueryCacheNow(queryClient)),
    );
    bindMonthsToStore(queryClient, store);
    persistBuffer(store);
    store.subscribeOps(() => sendOps(queryClient, store));
    queryClient.setQueryData<MonthStrokes>(monthKey(MONTH), { [DAY]: [confirmed("x", 1)] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [{ id: "a", seq: 2 }] })),
    );

    const slowDisk = Promise.withResolvers<void>();
    cacheWrite.gate = slowDisk.promise;
    store.commitStroke(stroke("a"));
    await vi.waitFor(() => expect(store.pendingCount()).toBe(0));
    await flush();

    expect(disk.get(CACHE_KEY)).toBeUndefined();
    expect(disk.get(BUFFER_KEY)).toMatchObject({ ops: [{ op: "add" }] });
    expect(await reopen()).toEqual(["a"]);

    slowDisk.resolve();
    await vi.waitFor(() => expect(disk.get(BUFFER_KEY)).toEqual({ ops: [], strokes: [] }));
    expect(disk.get(CACHE_KEY)).toBeDefined();
    expect(await reopen()).toEqual(["x", "a"]);
  });
});
