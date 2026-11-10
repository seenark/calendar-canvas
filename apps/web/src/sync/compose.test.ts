import { describe, expect, it } from "vite-plus/test";

import { composeDay } from "./compose";
import { confirmed, stroke } from "./fixtures";
import type { PendingOp } from "./ops";

const ids = (strokes: readonly { id: string }[]) => strokes.map((s) => s.id);

describe("composeDay", () => {
  it("orders confirmed Strokes by seq, whatever order they arrive in", () => {
    expect(ids(composeDay([confirmed("c", 3), confirmed("a", 1), confirmed("b", 2)], []))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("appends pending adds after confirmed Strokes in localSeq order", () => {
    const pending: PendingOp[] = [
      { op: "add", stroke: stroke("p2"), localSeq: 5 },
      { op: "add", stroke: stroke("p1"), localSeq: 4 },
    ];
    expect(ids(composeDay([confirmed("a", 1)], pending))).toEqual(["a", "p1", "p2"]);
  });

  it("removes a confirmed Stroke with a pending delete and brings it back with a later restore", () => {
    const del: PendingOp = { op: "delete", id: "a", localSeq: 1 };
    const restore: PendingOp = { op: "restore", id: "a", localSeq: 2 };
    const base = [confirmed("a", 1), confirmed("b", 2)];
    expect(ids(composeDay(base, [del]))).toEqual(["b"]);
    expect(ids(composeDay(base, [del, restore]))).toEqual(["a", "b"]);
  });

  it("lets the last Op per id win in localSeq order", () => {
    const base = [confirmed("a", 1)];
    const restore: PendingOp = { op: "restore", id: "a", localSeq: 1 };
    const del: PendingOp = { op: "delete", id: "a", localSeq: 2 };
    expect(ids(composeDay(base, [del, restore]))).toEqual([]);
  });

  it("drops a pending add that a later pending delete removed, and restores it in its add position", () => {
    const add = (id: string, localSeq: number): PendingOp => ({ op: "add", stroke: stroke(id), localSeq });
    const del: PendingOp = { op: "delete", id: "p1", localSeq: 3 };
    expect(ids(composeDay([], [add("p1", 1), add("p2", 2), del]))).toEqual(["p2"]);
    const restore: PendingOp = { op: "restore", id: "p1", localSeq: 4 };
    expect(ids(composeDay([], [add("p1", 1), add("p2", 2), del, restore]))).toEqual(["p1", "p2"]);
  });

  it("restores a server-deleted Stroke from the cache at its seq position", () => {
    const cache = new Map([["b", confirmed("b", 2)]]);
    const restore: PendingOp = { op: "restore", id: "b", localSeq: 1 };
    const base = [confirmed("a", 1), confirmed("c", 3)];
    expect(ids(composeDay(base, [], cache))).toEqual(["a", "c"]);
    expect(ids(composeDay(base, [restore], cache))).toEqual(["a", "b", "c"]);
  });

  it("ignores a restore with no data anywhere", () => {
    expect(ids(composeDay([], [{ op: "restore", id: "ghost", localSeq: 1 }]))).toEqual([]);
  });
});
