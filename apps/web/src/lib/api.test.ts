import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { QueryClient } from "@tanstack/react-query";

import { ApiError, api, fetchMe, meQuery } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api", () => {
  it("throws an ApiError carrying the server's error envelope", async () => {
    stubFetch(
      Response.json(
        { error: { code: "unauthorized", message: "sign in required" } },
        { status: 401 },
      ),
    );
    const err = await api("/api/me").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "unauthorized", message: "sign in required" });
  });

  it("sends JSON bodies with a JSON Content-Type", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await api("/api/x", { method: "POST", body: "{}" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("returns undefined for 204", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});

describe("fetchMe", () => {
  it("returns null for a 401 and rethrows other failures", async () => {
    stubFetch(Response.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }));
    expect(await fetchMe(new QueryClient())).toBeNull();

    stubFetch(Response.json({ error: { code: "internal", message: "x" } }, { status: 500 }));
    await expect(fetchMe(new QueryClient())).rejects.toMatchObject({ status: 500 });
  });

  it("returns the identity of a signed-in session", async () => {
    stubFetch(Response.json({ user: null, role: "admin" }));
    expect(await fetchMe(new QueryClient())).toEqual({ user: null, role: "admin" });
  });

  it("falls back to the identity of the last sign-in when the network or server fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(meQuery.queryKey, { user: null, role: "user" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await fetchMe(queryClient)).toEqual({ user: null, role: "user" });

    stubFetch(Response.json({ error: { code: "internal", message: "x" } }, { status: 503 }));
    expect(await fetchMe(queryClient)).toEqual({ user: null, role: "user" });
  });

  it("rethrows a network failure when no identity is cached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchMe(new QueryClient())).rejects.toBeInstanceOf(TypeError);
  });

  it("drops the cached identity when the server answers 401", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(meQuery.queryKey, { user: null, role: "user" });
    stubFetch(Response.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }));
    expect(await fetchMe(queryClient)).toBeNull();
    expect(queryClient.getQueryData(meQuery.queryKey)).toBeUndefined();
  });
});
