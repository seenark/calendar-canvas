import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { rememberMonth, startMonth } from "./last-month";

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startMonth", () => {
  it("opens on the current month when nothing is stored", () => {
    stubStorage();
    expect(startMonth()).toBe("2026-11");
  });

  it("opens on the last month the list published", () => {
    stubStorage();
    rememberMonth("2024-03");
    expect(startMonth()).toBe("2024-03");
  });

  it("ignores a stored value that is not a supported month", () => {
    stubStorage({ lastMonth: "2026-13" });
    expect(startMonth()).toBe("2026-11");
    stubStorage({ lastMonth: "garbage" });
    expect(startMonth()).toBe("2026-11");
  });

  it("opens on the current month when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(startMonth()).toBe("2026-11");
    expect(() => rememberMonth("2024-03")).not.toThrow();
  });
});
