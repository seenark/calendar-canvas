import { describe, expect, it } from "vite-plus/test";

import { ApiError } from "@/lib/api";

import { retryDelay, shouldRetry } from "./retry";

const http = (status: number) => new ApiError(status, "x", "x");

describe("shouldRetry", () => {
  it("retries network errors", () => {
    expect(shouldRetry(0, new TypeError("Failed to fetch"))).toBe(true);
  });

  it.each([408, 429, 500, 502, 503, 504])("retries %i", (status) => {
    expect(shouldRetry(3, http(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 413, 422])("never retries %i", (status) => {
    expect(shouldRetry(0, http(status))).toBe(false);
  });

  it("does not retry other errors", () => {
    expect(shouldRetry(0, new RangeError("bad"))).toBe(false);
  });
});

describe("retryDelay", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(retryDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});
