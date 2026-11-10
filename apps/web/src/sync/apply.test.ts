import { describe, expect, it } from "vite-plus/test";

import { applyResults } from "./apply";
import { confirmed, stroke } from "./fixtures";
import type { SentOp } from "./ops";

const DAY = "2026-11-10";
let localSeq = 0;
const add = (id: string): SentOp => ({
  op: "add",
  stroke: stroke(id),
  localSeq: localSeq++,
  day: DAY,
});
const del = (id: string): SentOp => ({ op: "delete", id, localSeq: localSeq++, day: DAY });
const restore = (id: string): SentOp => ({ op: "restore", id, localSeq: localSeq++, day: DAY });
const apply = (
  before: ReturnType<typeof confirmed>[],
  sent: SentOp[],
  results: Parameters<typeof applyResults>[2],
  seen = new Map<string, ReturnType<typeof confirmed>>(),
) => applyResults(before, sent, results, seen, 99).map((c) => `${c.id}@${c.seq}`);

describe("applyResults", () => {
  it("confirms an add with the server's seq, after the Strokes already confirmed", () => {
    const out = applyResults([confirmed("a", 1)], [add("b")], [{ id: "b", seq: 7 }], new Map(), 99);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out[1]).toMatchObject({ seq: 7, receivedAt: 99, day: DAY });
  });

  it("orders by seq, so another device's Stroke can sit between two of ours", () => {
    expect(
      apply(
        [confirmed("x", 5)],
        [add("a"), add("b")],
        [
          { id: "a", seq: 3 },
          { id: "b", seq: 8 },
        ],
      ),
    ).toEqual(["a@3", "x@5", "b@8"]);
  });

  it("a delete drops the Stroke and a restore brings it back from the session cache with its seq", () => {
    const c = confirmed("a", 4);
    expect(apply([c], [del("a")], [{ id: "a" }])).toEqual([]);
    expect(apply([], [restore("a")], [{ id: "a" }], new Map([["a", c]]))).toEqual(["a@4"]);
  });

  it("restores a Stroke added earlier in the same batch", () => {
    expect(
      apply(
        [],
        [add("a"), del("a"), restore("a")],
        [{ id: "a", seq: 2 }, { id: "a" }, { id: "a" }],
      ),
    ).toEqual(["a@2"]);
  });

  it("add then delete in one batch leaves nothing", () => {
    expect(apply([], [add("a"), del("a")], [{ id: "a", seq: 2 }, { id: "a" }])).toEqual([]);
  });

  it("a missing result drops the id and leaves the other Strokes", () => {
    expect(
      apply([confirmed("a", 1), confirmed("b", 2)], [del("a")], [{ id: "a", missing: true }]),
    ).toEqual(["b@2"]);
    expect(apply([confirmed("b", 2)], [restore("a")], [{ id: "a", missing: true }])).toEqual([
      "b@2",
    ]);
  });

  it("an add the server answered without a seq is rejected", () => {
    expect(() => applyResults([], [add("a")], [{ id: "a" }], new Map(), 0)).toThrow(RangeError);
  });
});
