import { describe, expect, it } from "vite-plus/test";

import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("has version 7 and RFC variant bits", () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("encodes the timestamp in the first 48 bits", () => {
    const id = uuidv7(0x0123_4567_89ab);
    expect(id.replace(/-/g, "").slice(0, 12)).toBe("0123456789ab");
  });

  it("sorts by creation time", () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });

  it("is unique", () => {
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});
