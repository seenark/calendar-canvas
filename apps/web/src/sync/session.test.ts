import { QueryClient } from "@tanstack/react-query";
import { getDefaultStore } from "jotai/vanilla";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { needsAuthAtom } from "@/state/auth";

import { DayStore } from "./day-store";
import { stroke } from "./fixtures";
import { STROKE_OPS_KEY, strokeOpsDefaults } from "./mutations";
import { resumeIfSignedIn } from "./session";

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
    strokeOpsDefaults(queryClient, store, async () => {}),
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
