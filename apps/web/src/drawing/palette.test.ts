import { describe, expect, it } from "vite-plus/test";
import { MAX_RECENT_COLORS, PALETTE, pushRecentColor } from "./palette";

describe("PALETTE", () => {
  it("holds the 10 Latte colours with the default Pen colour first", () => {
    expect(PALETTE).toHaveLength(10);
    expect(PALETTE[0]).toBe("#4c4f69");
  });
});

describe("pushRecentColor", () => {
  it("puts the newest colour first", () => {
    expect(pushRecentColor(["#111111"], "#222222")).toEqual(["#222222", "#111111"]);
  });

  it("moves a repeated colour to the front without duplicating it", () => {
    expect(pushRecentColor(["#111111", "#222222", "#333333"], "#333333")).toEqual([
      "#333333",
      "#111111",
      "#222222",
    ]);
  });

  it("keeps at most 5 colours, dropping the oldest", () => {
    const full = ["#1", "#2", "#3", "#4", "#5"];
    const next = pushRecentColor(full, "#6");
    expect(next).toHaveLength(MAX_RECENT_COLORS);
    expect(next).toEqual(["#6", "#1", "#2", "#3", "#4"]);
  });

  it("does not mutate its input", () => {
    const recent = ["#1"];
    pushRecentColor(recent, "#2");
    expect(recent).toEqual(["#1"]);
  });
});
