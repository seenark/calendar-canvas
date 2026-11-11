import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const disk = vi.hoisted(() => new Map<string, unknown>());
const slowWrite = vi.hoisted(() => ({ ms: 0 }));
const failWrite = vi.hoisted(() => ({ on: false }));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => disk.get(key),
  set: async (key: string, value: unknown) => {
    await new Promise((resolve) => setTimeout(resolve, slowWrite.ms));
    if (failWrite.on) throw new Error("quota");
    disk.set(key, value);
  },
  del: async (key: string) => void disk.delete(key),
}));

import { BUFFER_KEY, discardLocalData, persistBuffer, persistNow, restoreBuffer } from "./buffer";
import { DayStore } from "./day-store";
import { stroke } from "./fixtures";
import { CACHE_KEY } from "./persister";

describe("buffer persistence", () => {
  beforeEach(() => {
    disk.clear();
    slowWrite.ms = 0;
    failWrite.on = false;
  });

  it("persistNow rejects when the write fails, and writes the same snapshot again once storage recovers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new DayStore();
    persistBuffer(store);
    failWrite.on = true;
    store.commitStroke(stroke("a"));
    await expect(persistNow()).rejects.toThrow("quota");
    expect(disk.get(BUFFER_KEY)).toBeUndefined();
    failWrite.on = false;
    await persistNow();
    expect(disk.get(BUFFER_KEY)).toMatchObject({ ops: [{ localSeq: 0 }] });
  });

  it("persistNow resolves only after the latest Ops are in storage", async () => {
    const store = new DayStore();
    persistBuffer(store);
    slowWrite.ms = 20;
    store.commitStroke(stroke("a"));
    store.commitStroke(stroke("b"));
    expect(disk.get(BUFFER_KEY)).toBeUndefined();
    await persistNow();
    expect(disk.get(BUFFER_KEY)).toMatchObject({ ops: [{ localSeq: 0 }, { localSeq: 1 }] });
  });

  it("clears the saved record when restored Ops settle with no other change", async () => {
    const before = new DayStore();
    persistBuffer(before);
    before.commitStroke(stroke("a"));
    await persistNow();
    expect(disk.get(BUFFER_KEY)).toMatchObject({ ops: [{ op: "add" }] });

    const after = new DayStore();
    await restoreBuffer(after);
    persistBuffer(after);
    after.settle(after.takeUnsent(), [{ id: "a", seq: 1 }], 1);
    await persistNow();
    expect(disk.get(BUFFER_KEY)).toEqual({ ops: [], strokes: [] });
  });

  it("discardLocalData empties the store, the saved Ops, the saved cache and the cached identity", async () => {
    const store = new DayStore();
    persistBuffer(store);
    store.commitStroke(stroke("a"));
    await persistNow();
    disk.set(CACHE_KEY, "{}");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["me"], { role: "user" });

    await discardLocalData(queryClient, store);

    expect(disk.has(BUFFER_KEY)).toBe(false);
    expect(disk.has(CACHE_KEY)).toBe(false);
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
    expect(store.pendingCount()).toBe(0);
    await persistNow();
    expect(disk.has(BUFFER_KEY)).toBe(false);
  });
});
