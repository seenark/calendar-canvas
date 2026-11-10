import { QueryClient } from "@tanstack/react-query";
import { getDefaultStore } from "jotai/vanilla";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const persist = vi.hoisted(() => ({ now: vi.fn<() => Promise<void>>() }));
vi.mock("./buffer", async (original) => ({
  ...(await original<typeof import("./buffer")>()),
  persistNow: persist.now,
}));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import { ApiError } from "@/lib/api";
import { needsAuthAtom } from "@/state/auth";

import { DayStore } from "./day-store";
import { stroke } from "./fixtures";
import { STROKE_OPS_KEY, strokeOpsDefaults } from "./mutations";
import { monthQuery } from "./queries";
import { persistThenSignIn, resumeIfSignedIn, watchSession } from "./session";

const atoms = getDefaultStore();

afterEach(() => {
  vi.unstubAllGlobals();
  atoms.set(needsAuthAtom, false);
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(me: () => Response) {
  const queryClient = new QueryClient();
  const store = new DayStore();
  queryClient.setMutationDefaults(
    STROKE_OPS_KEY,
    strokeOpsDefaults(queryClient, store, { flush: async () => {}, onStored: () => () => {} }),
  );
  const posts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(init.body as string));
        return json({ results: [{ id: "a", seq: 1 }] });
      }
      return me();
    }),
  );
  store.commitStroke(stroke("a"));
  return { queryClient, store, posts };
}

describe("resumeIfSignedIn", () => {
  it("keeps needsAuth and sends nothing while /api/me answers 401", async () => {
    const { queryClient, store, posts } = setup(() =>
      json({ error: { code: "unauthorized" } }, 401),
    );
    atoms.set(needsAuthAtom, true);
    await resumeIfSignedIn(queryClient, store);
    expect(atoms.get(needsAuthAtom)).toBe(true);
    expect(posts).toEqual([]);
  });

  it("clears needsAuth and flushes the buffer once /api/me succeeds", async () => {
    const { queryClient, store, posts } = setup(() =>
      json({ user: { id: "u", email: "e", name: null, avatarUrl: null }, role: "user" }),
    );
    atoms.set(needsAuthAtom, true);
    await resumeIfSignedIn(queryClient, store);
    expect(atoms.get(needsAuthAtom)).toBe(false);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await vi.waitFor(() => expect(store.pendingCount()).toBe(0));
  });

  it("does not ask the server when needsAuth is not set", async () => {
    const { queryClient, store } = setup(() => json({}));
    await resumeIfSignedIn(queryClient, store);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("persistThenSignIn", () => {
  const location = { href: "" };
  beforeEach(() => {
    location.href = "";
    toasts.error.mockClear();
    vi.stubGlobal("window", { location });
  });

  it("goes to Google after the buffer is written", async () => {
    persist.now.mockResolvedValue();
    await persistThenSignIn("/d/2026-11-10");
    expect(location.href).toBe("/api/auth/google/start?return=%2Fd%2F2026-11-10");
  });

  it("stays on the page and says so when the write is rejected", async () => {
    persist.now.mockRejectedValue(new Error("quota"));
    await persistThenSignIn("/");
    expect(location.href).toBe("");
    expect(toasts.error).toHaveBeenCalledWith("บันทึกไม่สำเร็จ ลองอีกครั้ง");
  });
});

describe("watchSession", () => {
  const setupWatch = () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    const { queryClient, store } = setup(() => json({ error: { code: "unauthorized" } }, 401));
    atoms.set(needsAuthAtom, true);
    const stop = watchSession(queryClient, store);
    return { win, doc, stop };
  };

  it.each([
    ["focus", "window"],
    ["pageshow", "window"],
    ["visibilitychange", "document"],
  ] as const)("asks the server on %s", async (event, target) => {
    const watched = setupWatch();
    watched[target === "window" ? "win" : "doc"].dispatchEvent(new Event(event));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/me", expect.anything()));
    watched.stop();
  });

  it("ignores visibilitychange while hidden, and stops listening after stop", () => {
    const { win, doc, stop } = setupWatch();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    stop();
    win.dispatchEvent(new Event("focus"));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("monthQuery", () => {
  it("is not retried on a 4xx and sets needsAuth on a 401", async () => {
    const retry = monthQuery("2026-11").retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new ApiError(401, "unauthorized", "x"))).toBe(false);
    expect(retry(0, new ApiError(500, "internal", "x"))).toBe(true);
    expect(retry(3, new ApiError(500, "internal", "x"))).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "unauthorized" } }, 401)),
    );
    await expect(new QueryClient().fetchQuery(monthQuery("2026-11"))).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(atoms.get(needsAuthAtom)).toBe(true);
  });
});
