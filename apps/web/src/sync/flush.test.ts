import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { IDLE_MS, MAX_BUFFERED_OPS, createFlusher } from "./flush";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createFlusher", () => {
  it("flushes once after the buffer has been idle for 1.5 s", () => {
    const flush = vi.fn();
    const { onOp } = createFlusher(flush);
    onOp();
    vi.advanceTimersByTime(IDLE_MS - 1);
    onOp();
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * IDLE_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushes at 50 Ops without waiting, then counts again", () => {
    const flush = vi.fn();
    const { onOp } = createFlusher(flush);
    for (let i = 0; i < MAX_BUFFERED_OPS - 1; i++) onOp();
    expect(flush).not.toHaveBeenCalled();
    onOp();
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * IDLE_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    for (let i = 0; i < MAX_BUFFERED_OPS; i++) onOp();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("flushes on demand and cancels the idle timer", () => {
    const flush = vi.fn();
    const { onOp, now } = createFlusher(flush);
    onOp();
    now();
    vi.advanceTimersByTime(10 * IDLE_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
