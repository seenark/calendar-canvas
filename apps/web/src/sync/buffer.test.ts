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
}));

import { BUFFER_KEY, persistBuffer, persistNow, restoreBuffer } from "./buffer";
import { DayStore } from "./day-store";
import { stroke } from "./fixtures";

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
});
