import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ApiError, api } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api", () => {
  it("throws an ApiError carrying the server's error envelope", async () => {
    stubFetch(
      Response.json({ error: { code: "unauthorized", message: "sign in required" } }, { status: 401 }),
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
