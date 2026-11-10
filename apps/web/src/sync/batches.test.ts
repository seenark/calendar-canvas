import { describe, expect, it } from "vite-plus/test";

import { splitBatches } from "./batches";

const ops = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));
const sizes = (batches: unknown[][]) => batches.map((b) => b.length);

describe("splitBatches", () => {
  it("returns no batch for no Ops", () => {
    expect(splitBatches([], { maxOps: 200, maxBytes: 1_500_000 })).toEqual([]);
  });

  it("keeps up to maxOps Ops in a batch and splits the rest in order", () => {
    const input = ops(450);
    const batches = splitBatches(input, { maxOps: 200, maxBytes: 1_500_000 });
    expect(sizes(batches)).toEqual([200, 200, 50]);
    expect(batches.flat()).toEqual(input);
  });

  it("splits by encoded size", () => {
    const big = (id: string) => ({ id, pad: "x".repeat(400) });
    const input = [big("a"), big("b"), big("c"), big("d"), big("e")];
    const batches = splitBatches(input, { maxOps: 200, maxBytes: 1100 });
    expect(sizes(batches)).toEqual([2, 2, 1]);
    for (const batch of batches)
      expect(JSON.stringify({ ops: batch }).length).toBeLessThanOrEqual(1100);
    expect(batches.flat()).toEqual(input);
  });

  it("measures the wire form, not the Op", () => {
    const input = [{ points: "x".repeat(900) }, { points: "y".repeat(900) }];
    expect(splitBatches(input, { maxOps: 200, maxBytes: 1100 })).toHaveLength(2);
    expect(splitBatches(input, { maxOps: 200, maxBytes: 1100 }, () => ({ id: "a" }))).toHaveLength(
      1,
    );
  });

  it("puts an Op larger than maxBytes in a batch of its own", () => {
    const input = [{ id: "a" }, { id: "huge", pad: "x".repeat(2000) }, { id: "b" }];
    expect(sizes(splitBatches(input, { maxOps: 200, maxBytes: 500 }))).toEqual([1, 1, 1]);
  });
});
