import { QueryClient, hydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const disk = vi.hoisted(() => new Map<string, unknown>());
const cacheWrite = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  failure: null as Error | null,
  started: 0,
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => disk.get(key),
  del: async (key: string) => void disk.delete(key),
  set: async (key: string, value: unknown) => {
    if (key === "REACT_QUERY_OFFLINE_CACHE") {
      cacheWrite.started++;
      await cacheWrite.gate;
      if (cacheWrite.failure) throw cacheWrite.failure;
    }
    disk.set(key, value);
  },
}));

import { BUFFER_KEY, persistBuffer, restoreBuffer } from "./buffer";
import { DayStore } from "./day-store";
import { confirmed, stroke } from "./fixtures";
import { STROKE_OPS_KEY, sendOps, strokeOpsDefaults } from "./mutations";
import { createQueryCachePersister } from "./persister";
import { bindMonthsToStore, monthKey, type MonthStrokes } from "./queries";

const DAY = "2026-11-10";
const MONTH = "2026-11";
const CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
beforeEach(() => {
  disk.clear();
  cacheWrite.gate = null;
  cacheWrite.failure = null;
  cacheWrite.started = 0;
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

function setup() {
  const queryClient = new QueryClient();
  const store = new DayStore();
  const persister = createQueryCachePersister(queryClient);
  queryClient.setMutationDefaults(STROKE_OPS_KEY, strokeOpsDefaults(queryClient, store, persister));
  bindMonthsToStore(queryClient, store);
  persistBuffer(store);
  store.subscribeOps(() => sendOps(queryClient, store));
  queryClient.setQueryData<MonthStrokes>(monthKey(MONTH), { [DAY]: [confirmed("x", 1)] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ results: [{ id: "a", seq: 2 }] })),
  );
  return { queryClient, store, persister };
}

describe("settling an Op", () => {
  it("keeps the Op in the saved buffer until the month cache holding its Stroke is saved", async () => {
    const { store } = setup();

    const slowDisk = Promise.withResolvers<void>();
    cacheWrite.gate = slowDisk.promise;
    store.commitStroke(stroke("a"));
    await vi.waitFor(() => expect(store.pendingCount()).toBe(0));
    await tick();

    expect(disk.get(CACHE_KEY)).toBeUndefined();
    expect(disk.get(BUFFER_KEY)).toMatchObject({ ops: [{ op: "add" }] });
    expect(await reopen()).toEqual(["a"]);

    slowDisk.resolve();
    await vi.waitFor(() => expect(disk.get(BUFFER_KEY)).toEqual({ ops: [], strokes: [] }));
    expect(disk.get(CACHE_KEY)).toBeDefined();
    expect(await reopen()).toEqual(["x", "a"]);
  });

  it("keeps the Op when the cache write fails and releases it after a later successful flush", async () => {
    const { store, persister } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    cacheWrite.failure = new Error("quota");
    store.commitStroke(stroke("a"));
    await vi.waitFor(() => expect(store.pendingCount()).toBe(0));
    await vi.waitFor(() => expect(cacheWrite.started).toBe(1));
    await tick();

    expect(disk.get(CACHE_KEY)).toBeUndefined();
    expect(disk.get(BUFFER_KEY)).toMatchObject({ ops: [{ op: "add" }] });
    expect(await reopen()).toEqual(["a"]);

    cacheWrite.failure = null;
    await persister.flush();
    await vi.waitFor(() => expect(disk.get(BUFFER_KEY)).toEqual({ ops: [], strokes: [] }));
    expect(await reopen()).toEqual(["x", "a"]);
  });
});

describe("query cache persister", () => {
  it("rejects a flush whose write failed", async () => {
    const queryClient = new QueryClient();
    const persister = createQueryCachePersister(queryClient);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    cacheWrite.failure = new Error("quota");
    await expect(persister.flush()).rejects.toThrow("quota");
  });

  it("leaves the newest snapshot on disk when the cache changes during a slow write", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const persister = createQueryCachePersister(queryClient);
    const snapshot = () =>
      JSON.parse(disk.get(CACHE_KEY) as string).clientState.queries[0].state.data;

    queryClient.setQueryData(monthKey(MONTH), "old");
    const slowDisk = Promise.withResolvers<void>();
    cacheWrite.gate = slowDisk.promise;
    void persister.persistClient({} as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cacheWrite.started).toBe(1);

    cacheWrite.gate = null;
    queryClient.setQueryData(monthKey(MONTH), "new");
    void persister.persistClient({} as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cacheWrite.started).toBe(1);

    slowDisk.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(cacheWrite.started).toBe(2);
    expect(snapshot()).toBe("new");
  });
});
