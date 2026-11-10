import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Stroke } from "@/api/types";
import { bytesToBase64 } from "@/ink/base64";
import { encodePoints } from "@/ink/codec";

import { DayStore } from "./day-store";
import { confirmed, stroke } from "./fixtures";
import { STROKE_OPS_KEY, sendOps, strokeOpsDefaults, toWireOp } from "./mutations";
import { bindMonthsToStore, decodeMonth, monthKey, type MonthStrokes } from "./queries";

const DAY = "2026-11-10";
const MONTH = "2026-11";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const store = new DayStore();
  queryClient.setMutationDefaults(STROKE_OPS_KEY, strokeOpsDefaults(queryClient, store));
  bindMonthsToStore(queryClient, store);
  store.subscribeOps(() => sendOps(queryClient, store));
  return { queryClient, store };
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("wire format", () => {
  it("encodes an add with base64 points and decodes a month back into Strokes grouped by Day", () => {
    const s = stroke("a");
    const wire = toWireOp({ op: "add", stroke: s, localSeq: 0, day: DAY });
    expect(wire).toMatchObject({ op: "add", stroke: { id: "a", day: DAY, bbox: s.bbox, createdAt: 0 } });
    const input = wire.stroke!;
    const stored: Stroke = { ...input, seq: 3, receivedAt: 9 };
    const days = decodeMonth({ strokes: [stored] });
    expect(days[DAY]).toMatchObject([{ id: "a", seq: 3, receivedAt: 9, hasPressure: false }]);
    expect(input.points).toBe(bytesToBase64(encodePoints(s.points, { hasPressure: false })));
  });

  it("sends a delete as the id alone", () => {
    expect(toWireOp({ op: "delete", id: "a", localSeq: 0, day: DAY })).toEqual({ op: "delete", id: "a" });
  });
});

describe("sending", () => {
  it("confirms a Stroke into the month cache with its seq and does not redraw the Day", async () => {
    const { queryClient, store } = setup();
    queryClient.setQueryData<MonthStrokes>(monthKey(MONTH), { [DAY]: [confirmed("x", 1)] });
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return respond({ results: [{ id: "a", seq: 2 }] });
      }),
    );
    store.commitStroke(stroke("a"));
    const before = store.getSnapshot(DAY);
    await vi.waitFor(() =>
      expect(queryClient.getQueryData<MonthStrokes>(monthKey(MONTH))?.[DAY]).toHaveLength(2),
    );
    expect(queryClient.getQueryData<MonthStrokes>(monthKey(MONTH))![DAY]![1]).toMatchObject({
      id: "a",
      seq: 2,
    });
    expect(bodies).toHaveLength(1);
    expect(store.getSnapshot(DAY)).toBe(before);
    expect(store.takeUnsent()).toEqual([]);
  });

  it("feeds fetched month data into the store without touching Pending ops", () => {
    const { queryClient, store } = setup();
    store.commitStroke(stroke("p"));
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    queryClient.setQueryData<MonthStrokes>(monthKey(MONTH), { [DAY]: [confirmed("x", 1)] });
    expect(store.getSnapshot(DAY).strokes.map((s) => s.id)).toEqual(["x", "p"]);
    expect(queryClient.getQueryData<MonthStrokes>(monthKey(MONTH))![DAY]!.map((s) => s.id)).toEqual(["x"]);
  });

  it("returns the Ops to the unsent set when the batch fails", async () => {
    const { queryClient, store } = setup();
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "internal" } }, 500)));
    store.commitStroke(stroke("a"));
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("error"));
    expect(store.takeUnsent()).toHaveLength(1);
  });
});
