import { describe, expect, it } from "vite-plus/test";

import { LruCache, thumbnailKey } from "./cache";

describe("thumbnailKey", () => {
  it("changes with the revision", () => {
    expect(thumbnailKey("2026-11-10", 1, 50, 62)).not.toBe(thumbnailKey("2026-11-10", 2, 50, 62));
  });

  it("changes with the pixel size", () => {
    expect(thumbnailKey("2026-11-10", 1, 50, 62)).not.toBe(thumbnailKey("2026-11-10", 1, 100, 125));
  });

  it("starts with the Day and the revision", () => {
    expect(thumbnailKey("2026-11-10", 3, 50, 62).startsWith("2026-11-10:3")).toBe(true);
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry past capacity", () => {
    const evicted: number[] = [];
    const cache = new LruCache<number>(2, (v) => evicted.push(v));
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(evicted).toEqual([2]);
    expect(cache.size).toBe(2);
  });

  it("evicts a value it replaces but not the same value set again", () => {
    const evicted: number[] = [];
    const cache = new LruCache<number>(2, (v) => evicted.push(v));
    cache.set("a", 1);
    cache.set("a", 1);
    expect(evicted).toEqual([]);
    cache.set("a", 2);
    expect(evicted).toEqual([1]);
    expect(cache.get("a")).toBe(2);
  });

  it("treats a new revision key as a miss", () => {
    const cache = new LruCache<string>(10);
    cache.set(thumbnailKey("2026-11-10", 1, 50, 62), "old");
    expect(cache.get(thumbnailKey("2026-11-10", 2, 50, 62))).toBeUndefined();
    expect(cache.get(thumbnailKey("2026-11-10", 1, 50, 62))).toBe("old");
  });
});
