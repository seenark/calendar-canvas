import { describe, expect, it } from "vite-plus/test";

import { MAX_PRUNE_IDS, isBusy, pruneBatches, pruneGate, verificationWidth } from "./rules";

const pens = (n: number) => Array.from({ length: n }, () => ({ kind: "pen" as const }));
const erasers = (n: number) => Array.from({ length: n }, () => ({ kind: "eraser" as const }));

describe("isBusy", () => {
  it("needs 300 Strokes or 100 Erasers", () => {
    expect(isBusy(pens(299))).toBe(false);
    expect(isBusy(pens(300))).toBe(true);
    expect(isBusy([...pens(150), ...erasers(99)])).toBe(false);
    expect(isBusy([...pens(10), ...erasers(100)])).toBe(true);
  });
});

describe("pruneGate", () => {
  it("runs a busy Day once per session and waits for pointers to lift", () => {
    expect(pruneGate(pens(300), false, 0)).toBe("run");
    expect(pruneGate(pens(300), false, 1)).toBe("defer");
    expect(pruneGate(pens(300), true, 0)).toBe("skip");
    expect(pruneGate(pens(10), false, 0)).toBe("skip");
  });
});

describe("pruneBatches", () => {
  const strokes = [
    { id: "p1", kind: "pen" as const },
    { id: "e1", kind: "eraser" as const },
    { id: "p2", kind: "pen" as const },
    { id: "e2", kind: "eraser" as const },
  ];

  it("puts every Pen before every Eraser", () => {
    expect(pruneBatches(["e1", "p1", "e2", "p2"], strokes)).toEqual([["p1", "p2", "e1", "e2"]]);
  });

  it("caps each request and still ends with the Erasers", () => {
    const many = Array.from({ length: MAX_PRUNE_IDS + 5 }, (_, i) => ({
      id: `p${i}`,
      kind: "pen" as const,
    }));
    const all = [...many, { id: "e", kind: "eraser" as const }];
    const batches = pruneBatches(["e", ...many.map((s) => s.id)], all);
    expect(batches.map((b) => b.length)).toEqual([MAX_PRUNE_IDS, 6]);
    expect(batches.flat().at(-1)).toBe("e");
  });

  it("sends nothing when nothing is pruned", () => {
    expect(pruneBatches([], strokes)).toEqual([]);
  });
});

describe("verificationWidth", () => {
  it("is the paper width times the device pixel ratio", () => {
    expect(verificationWidth(390, 3)).toBe(1170);
    expect(verificationWidth(390, 1)).toBe(390);
  });
});
