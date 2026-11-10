import { describe, expect, it } from "vite-plus/test";

import { drawStrokes } from "@/drawing/render";
import type { Stroke } from "@/drawing/stroke";
import { DAY_ASPECT } from "@/ink/constants";
import { strokeBBox } from "@/ink/bbox";
import type { InkPoint } from "@/ink/point";
import type { ConfirmedStroke } from "@/sync/ops";

import { MIN_AGE_MS, planPrune, type PruneResult } from "./plan";

const NOW = Date.UTC(2026, 10, 11);
const OLD = NOW - 2 * MIN_AGE_MS;
const WIDTH = 400;

const createCanvas = (width: number, height: number) => new OffscreenCanvas(width, height);

function line(x0: number, y: number, x1: number): InkPoint[] {
  return Array.from({ length: 9 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 8, y }));
}

type Spec = { id: string; seq: number; points: InkPoint[]; size: number; receivedAt?: number };

function pen({ id, seq, points, size, receivedAt = OLD }: Spec): ConfirmedStroke {
  return {
    id,
    seq,
    receivedAt,
    day: "2026-11-01",
    kind: "pen",
    color: "#1e66f5",
    size,
    points,
    hasPressure: false,
    bbox: strokeBBox(points, size, "pen"),
    createdAt: receivedAt,
  };
}

function eraser(spec: Spec): ConfirmedStroke {
  return {
    ...pen(spec),
    kind: "eraser",
    color: null,
    bbox: strokeBBox(spec.points, spec.size, "eraser"),
  };
}

function plan(strokes: ConfirmedStroke[], protectedIds: string[] = []): PruneResult {
  return planPrune({
    strokes,
    now: NOW,
    protectedIds: new Set(protectedIds),
    width: WIDTH,
    createCanvas,
  });
}

const deleted = (result: PruneResult): string[] => {
  if ("aborted" in result) throw new Error(`aborted: ${result.aborted}`);
  return result.deleteIds.toSorted();
};

const PEN = { points: line(0.3, 0.5, 0.6), size: 0.02 };
const COVER = { points: line(0.2, 0.5, 0.7), size: 0.1 };

describe("planPrune", () => {
  it("prunes a fully erased Stroke and the Eraser that erased it", () => {
    const result = plan([pen({ id: "p", seq: 1, ...PEN }), eraser({ id: "e", seq: 2, ...COVER })]);
    expect(deleted(result)).toEqual(["e", "p"]);
  });

  it("keeps a partially erased Stroke and its Eraser", () => {
    const half = { points: line(0.1, 0.5, 0.4), size: 0.1 };
    const result = plan([pen({ id: "p", seq: 1, ...PEN }), eraser({ id: "e", seq: 2, ...half })]);
    expect(deleted(result)).toEqual([]);
  });

  it("prunes an Eraser over empty paper and keeps the Stroke elsewhere", () => {
    const empty = { points: line(0.3, 0.9, 0.6), size: 0.04 };
    const result = plan([pen({ id: "p", seq: 1, ...PEN }), eraser({ id: "e", seq: 2, ...empty })]);
    expect(deleted(result)).toEqual(["e"]);
  });

  it("does not use an Eraser newer than 24 hours as evidence", () => {
    const fresh = NOW - MIN_AGE_MS / 2;
    const result = plan([
      pen({ id: "p", seq: 1, ...PEN }),
      eraser({ id: "e", seq: 2, receivedAt: fresh, ...COVER }),
    ]);
    expect(deleted(result)).toEqual([]);
  });

  it("never lets an Eraser with a lower seq prune a later Stroke", () => {
    const result = plan([eraser({ id: "e", seq: 1, ...COVER }), pen({ id: "p", seq: 2, ...PEN })]);
    expect(deleted(result)).toEqual(["e"]);
  });

  it("leaves Strokes named by Pending ops or the undo stack", () => {
    const result = plan(
      [pen({ id: "p", seq: 1, ...PEN }), eraser({ id: "e", seq: 2, ...COVER })],
      ["p"],
    );
    expect(deleted(result)).toEqual([]);
  });

  it("aborts and prunes nothing when verification finds a pixel difference", () => {
    const wide = pen({ id: "p", seq: 1, points: line(0.2, 0.5, 0.8), size: 0.02 });
    const understated: ConfirmedStroke = { ...wide, bbox: [0.18, 0.48, 0.42, 0.52] };
    const erased = eraser({ id: "e", seq: 2, points: line(0.1, 0.5, 0.45), size: 0.1 });
    const result = plan([understated, erased]);
    expect(result).toEqual({ aborted: expect.stringContaining("pixels differ") });
  });

  it("leaves the picture of a busy Day identical", () => {
    const strokes: ConfirmedStroke[] = [];
    let seq = 0;
    for (let i = 0; i < 400; i++) {
      const cx = 0.03 + (i % 20) * 0.047;
      const cy = 0.03 + Math.floor(i / 20) * 0.04;
      const pair = i % 3;
      if (pair !== 2) {
        const penPoints = line(cx - 0.01, cy, cx + 0.01);
        strokes.push(pen({ id: `p${i}`, seq: ++seq, points: penPoints, size: 0.004 }));
      }
      const points =
        pair === 1 ? line(cx - 0.02, cy, cx - 0.005) : line(cx - 0.012, cy, cx + 0.012);
      strokes.push(eraser({ id: `e${i}`, seq: ++seq, points, size: pair === 1 ? 0.01 : 0.03 }));
    }
    const ids = deleted(plan(strokes));
    expect(ids).toContain("p0");
    expect(ids).toContain("e0");
    expect(ids).toContain("e2");
    expect(ids).not.toContain("p1");
    expect(ids).not.toContain("e1");

    const gone = new Set(ids);
    const render = (list: Stroke[]) => {
      const canvas = createCanvas(WIDTH, Math.round(WIDTH * DAY_ASPECT));
      const ctx = canvas.getContext("2d")!;
      drawStrokes(ctx, list);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const before = render(strokes);
    expect(before.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    expect(render(strokes.filter((s) => !gone.has(s.id)))).toEqual(before);
  });
});
