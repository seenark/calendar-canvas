import { QueryClient, hydrate } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Stroke } from "@/api/types";
import { bytesToBase64 } from "@/ink/base64";
import { encodePoints } from "@/ink/codec";

import { DayStore } from "./day-store";
import type { SentOp } from "./ops";
import { confirmed, stroke } from "./fixtures";
import { STROKE_OPS_KEY, adoptRestoredStrokeOps, sendOps, strokeOpsDefaults, toWireOp } from "./mutations";
import { bindMonthsToStore, decodeMonth, monthKey, monthQuery, type MonthStrokes } from "./queries";

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

/** Lets queued microtasks and I/O callbacks run, to prove that nothing more was sent. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Routes `fetch`: every POST waits for the test to answer it, every GET is answered by `get`. */
function server(get: (call: number) => Promise<Response> | Response) {
  const posts: {
    ops: { op: string; id?: string; stroke?: { id: string } }[];
    reply: (r: Response) => void;
  }[] = [];
  let gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(get(gets++));
      const reply = Promise.withResolvers<Response>();
      posts.push({ ...JSON.parse(init.body as string), reply: reply.resolve });
      return reply.promise;
    }),
  );
  return { posts, gets: () => gets };
}

const opIds = (post: { ops: { id?: string; stroke?: { id: string } }[] }) =>
  post.ops.map((o) => o.stroke?.id ?? o.id);
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("wire format", () => {
  it("encodes an add with base64 points and decodes a month back into Strokes grouped by Day", () => {
    const s = stroke("a");
    const wire = toWireOp({ op: "add", stroke: s, localSeq: 0, day: DAY });
    expect(wire).toMatchObject({
      op: "add",
      stroke: { id: "a", day: DAY, bbox: s.bbox, createdAt: 0 },
    });
    const input = wire.stroke!;
    const stored: Stroke = { ...input, seq: 3, receivedAt: 9 };
    const days = decodeMonth({ strokes: [stored] });
    expect(days[DAY]).toMatchObject([{ id: "a", seq: 3, receivedAt: 9, hasPressure: false }]);
    expect(input.points).toBe(bytesToBase64(encodePoints(s.points, { hasPressure: false })));
  });

  it("sends a delete as the id alone", () => {
    expect(toWireOp({ op: "delete", id: "a", localSeq: 0, day: DAY })).toEqual({
      op: "delete",
      id: "a",
    });
  });
});

describe("month decoding", () => {
  it("skips an undecodable Stroke and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = toWireOp({ op: "add", stroke: stroke("good"), localSeq: 0, day: DAY }).stroke!;
    const bad = { ...good, id: "bad", points: "AA==" };
    const days = decodeMonth({
      strokes: [
        { ...bad, seq: 1, receivedAt: 1 },
        { ...good, seq: 2, receivedAt: 2 },
      ],
    });
    expect(days[DAY]?.map((s) => s.id)).toEqual(["good"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad"), expect.anything());
    warn.mockRestore();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    queryClient.setQueryData<MonthStrokes>(monthKey(MONTH), { [DAY]: [confirmed("x", 1)] });
    expect(store.getSnapshot(DAY).strokes.map((s) => s.id)).toEqual(["x", "p"]);
    expect(queryClient.getQueryData<MonthStrokes>(monthKey(MONTH))![DAY]!.map((s) => s.id)).toEqual(
      ["x"],
    );
  });

  it("sends one batch at a time, each reading the Ops queued so far", async () => {
    const { store } = setup();
    const { posts } = server(() => respond({ strokes: [] }));
    store.commitStroke(stroke("a"));
    store.commitStroke(stroke("b"));
    store.undo(DAY);
    await flush();
    expect(posts).toHaveLength(1);
    expect(opIds(posts[0]!)).toEqual(["a"]);
    posts[0]!.reply(respond({ results: [{ id: "a", seq: 1 }] }));
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.ops.map((o) => o.op)).toEqual(["add", "delete"]);
    expect(opIds(posts[1]!)).toEqual(["b", "b"]);
    posts[1]!.reply(respond({ results: [{ id: "b", seq: 2 }, { id: "b" }] }));
    await vi.waitFor(() => expect(store.takeUnsent()).toEqual([]));
    expect(posts).toHaveLength(2);
  });

  it("sends a flush as consecutive batches of at most 200 Ops, in order", async () => {
    const queryClient = new QueryClient();
    const store = new DayStore();
    queryClient.setMutationDefaults(STROKE_OPS_KEY, strokeOpsDefaults(queryClient, store));
    const { posts } = server(() => respond({ strokes: [] }));
    const ids = Array.from({ length: 450 }, (_, i) => `s${i}`);
    for (const id of ids) store.commitStroke(stroke(id));
    sendOps(queryClient, store);
    for (const [i, size] of [200, 200, 50].entries()) {
      await vi.waitFor(() => expect(posts).toHaveLength(i + 1));
      const post = posts[i]!;
      expect(post.ops).toHaveLength(size);
      post.reply(respond({ results: opIds(post).map((id, n) => ({ id, seq: i * 200 + n + 1 })) }));
    }
    await vi.waitFor(() => expect(store.pendingCount()).toBe(0));
    expect(posts.flatMap(opIds)).toEqual(ids);
  });

  it("sends nothing after a failed batch and keeps every Op in order for the next trigger", async () => {
    const { queryClient, store } = setup();
    const { posts } = server(() => respond({ strokes: [] }));
    store.commitStroke(stroke("a"));
    store.undo(DAY);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    posts[0]!.reply(respond({ error: { code: "invalid" } }, 400));
    await vi.waitFor(() =>
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("error"),
    );
    await flush();
    expect(posts).toHaveLength(1);
    store.commitStroke(stroke("b"));
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.ops.map((o) => o.op)).toEqual(["add", "delete", "add"]);
    expect(opIds(posts[1]!)).toEqual(["a", "a", "b"]);
  });

  it("keeps a Stroke confirmed while its month's first GET, which read before the commit, is in flight", async () => {
    const { queryClient, store } = setup();
    const late = Promise.withResolvers<Response>();
    const s = stroke("a");
    const stored = {
      ...toWireOp({ op: "add", stroke: s, localSeq: 0, day: DAY }).stroke!,
      seq: 1,
      receivedAt: 1,
    };
    const { posts, gets } = server((call) =>
      call === 0 ? late.promise : respond({ strokes: [stored] }),
    );
    void queryClient.prefetchQuery(monthQuery(MONTH));
    store.commitStroke(s);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    posts[0]!.reply(respond({ results: [{ id: "a", seq: 1 }] }));
    await vi.waitFor(() => expect(gets()).toBe(2));
    late.resolve(respond({ strokes: [] }));
    await vi.waitFor(() =>
      expect(queryClient.getQueryData<MonthStrokes>(monthKey(MONTH))?.[DAY]).toHaveLength(1),
    );
    expect(store.getSnapshot(DAY).strokes.map((x) => x.id)).toEqual(["a"]);
  });

  it("does not redraw when a refetch returns the same Strokes", async () => {
    const { queryClient, store } = setup();
    const stored = {
      ...toWireOp({ op: "add", stroke: stroke("x"), localSeq: 0, day: DAY }).stroke!,
      seq: 1,
      receivedAt: 1,
    };
    server(() => respond({ strokes: [stored] }));
    await queryClient.fetchQuery(monthQuery(MONTH));
    const before = store.getSnapshot(DAY);
    expect(before.strokes.map((x) => x.id)).toEqual(["x"]);
    await queryClient.refetchQueries({ queryKey: monthKey(MONTH) });
    expect(store.getSnapshot(DAY)).toBe(before);
  });
  it("returns the Ops to the unsent set when the batch fails", async () => {
    const { queryClient, store } = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ error: { code: "invalid" } }, 400)),
    );
    store.commitStroke(stroke("a"));
    await vi.waitFor(() =>
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("error"),
    );
    expect(store.takeUnsent()).toHaveLength(1);
  });
});

describe("restoring a session", () => {
  const pausedMutation = (ops: SentOp[]) => ({
    mutationKey: STROKE_OPS_KEY,
    scope: { id: "strokeOps" },
    state: {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 1,
      failureReason: new TypeError("Failed to fetch"),
      isPaused: true,
      status: "pending" as const,
      variables: { ops },
      submittedAt: 0,
    },
  });
  const add = (id: string, localSeq: number): SentOp => ({
    op: "add",
    stroke: stroke(id),
    localSeq,
    day: DAY,
  });

  it("sends each restored Op once, resuming the paused batch and then the rest, and drops a batch that already settled", async () => {
    const { queryClient, store } = setup();
    const [a, b, c] = [add("a", 5), add("b", 6), add("c", 7)];
    store.restore({ ops: [a, b, c], strokes: [] });
    hydrate(queryClient, {
      mutations: [pausedMutation([add("settled", 1)]), pausedMutation([a, b])],
      queries: [],
    });
    const { posts } = server(() => respond({ strokes: [] }));

    adoptRestoredStrokeOps(queryClient, store);
    void queryClient.resumePausedMutations();
    await flush();
    expect(posts.map(opIds)).toEqual([["a", "b"]]);

    posts[0]!.reply(respond({ results: [{ id: "a", seq: 1 }, { id: "b", seq: 2 }] }));
    await flush();
    expect(posts.map(opIds)).toEqual([["a", "b"], ["c"]]);

    posts[1]!.reply(respond({ results: [{ id: "c", seq: 3 }] }));
    await flush();
    expect(posts).toHaveLength(2);
    expect(store.snapshotPending().ops).toEqual([]);
  });
});
