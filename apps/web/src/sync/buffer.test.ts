import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
  get: async (key: string) => disk.get(key),
  set: async (key: string, value: unknown) => void disk.set(key, value),
}));

import { BUFFER_KEY, persistBuffer, restoreBuffer } from "./buffer";
import { DayStore } from "./day-store";
import { stroke } from "./fixtures";

const flushWrites = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("buffer persistence", () => {
  beforeEach(() => disk.clear());

  it("clears the saved record when restored Ops settle with no other change", async () => {
    const before = new DayStore();
    persistBuffer(before);
    before.commitStroke(stroke("a"));
    await flushWrites();
    expect(disk.get(BUFFER_KEY)).toMatchObject({ ops: [{ op: "add" }] });

    const after = new DayStore();
    await restoreBuffer(after);
    persistBuffer(after);
    after.settle(after.takeUnsent(), [{ id: "a", seq: 1 }], 1);
    await flushWrites();
    expect(disk.get(BUFFER_KEY)).toEqual({ ops: [], strokes: [] });
  });
});
