import { describe, expect, it } from "vite-plus/test";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("base64", () => {
  it("round-trips all byte values", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips input larger than one chunk", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("matches the standard alphabet", () => {
    expect(bytesToBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
  });
});
