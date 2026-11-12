import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ApiError, api } from "@/lib/api";
import type * as ApiModule from "@/lib/api";
import { formatThaiMonth } from "@/lib/date";

import { MonthList, type MonthListHandle } from "./month-list";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: vi.fn(),
}));

// @tanstack/virtual-core reads this once, when the first virtualizer asks. On iOS it defers its
// own scroll writes while a touch or its momentum tail is in motion.
Object.defineProperty(navigator, "userAgent", {
  value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
});

const INITIAL = "2026-06";
// The list opens on three months each side: 2026-03 .. 2026-09.
const OLDER = ["2026-02", "2026-01", "2025-12"];
const NEWER = ["2026-10", "2026-11", "2026-12"];
const VIEWPORT = { width: 390, height: 844 };

const PROMPT_TOP = "ดึงเพื่อโหลดเดือนก่อนหน้า";
const PROMPT_BOTTOM = "ดึงเพื่อโหลดเดือนถัดไป";
const RELEASE = "ปล่อยเพื่อโหลด";
const LOADING = "กำลังโหลด…";
const FAILED = "โหลดไม่สำเร็จ ดึงเพื่อลองใหม่";

// The app styles these with Tailwind classes, which this config does not load.
const STYLE = `
  .flex { display: flex; } .flex-col { flex-direction: column; } .flex-1 { flex: 1 1 0%; }
  .min-h-0 { min-height: 0; } .overflow-y-auto { overflow-y: auto; }
  .relative { position: relative; } .absolute { position: absolute; }
  .top-0 { top: 0; } .left-0 { left: 0; } .w-full { width: 100%; }
  .grid { display: grid; } .grid-cols-7 { grid-template-columns: repeat(7, minmax(0, 1fr)); }
`;

type Deferred = { resolve: () => void; reject: (error: unknown) => void };

/** Months whose request stays open until the test settles it. Every other month answers at once. */
const held = new Map<string, Deferred>();
const holding = new Set<string>();

let root: Root | undefined;
let host: HTMLElement | undefined;
let style: HTMLStyleElement | undefined;
let queryClient: QueryClient | undefined;

beforeEach(() => {
  vi.mocked(api).mockImplementation(((path: string) => {
    const yearMonth = path.slice(-7);
    if (!holding.has(yearMonth)) return Promise.resolve({ strokes: [] });
    return new Promise<{ strokes: [] }>((resolve, reject) => {
      held.set(yearMonth, { resolve: () => resolve({ strokes: [] }), reject });
    });
  }) as typeof api);
});

afterEach(() => {
  root?.unmount();
  host?.remove();
  style?.remove();
  queryClient?.clear();
  root = host = style = queryClient = undefined;
  held.clear();
  holding.clear();
});

const settle = (months: string[], how: "resolve" | "reject") => {
  for (const month of months) {
    if (how === "resolve") held.get(month)!.resolve();
    else held.get(month)!.reject(new ApiError(400, "bad", "bad"));
  }
};

async function mount() {
  host = document.createElement("div");
  host.style.cssText = `display:flex;flex-direction:column;position:relative;width:${VIEWPORT.width}px;height:${VIEWPORT.height}px`;
  style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  document.body.append(host);

  queryClient = new QueryClient();
  const ref = createRef<MonthListHandle>();
  const rootRoute = createRootRoute({
    component: () =>
      createElement(
        QueryClientProvider,
        { client: queryClient! },
        createElement(MonthList, { initialMonth: INITIAL, routeMonth: INITIAL, ref }),
      ),
  });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/m/$yearMonth" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/d/$date" }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/m/${INITIAL}`] }),
  });
  root = createRoot(host);
  flushSync(() => root!.render(createElement(RouterProvider, { router })));

  await expect.poll(() => host!.querySelector("[data-month-scroll]")).toBeTruthy();
  const scroller = host.querySelector<HTMLElement>("[data-month-scroll]")!;
  await expect.poll(() => has(formatThaiMonth(INITIAL))).toBe(true);
  // The list opens with the initial month at the top.
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
  return { scroller, ref };
}

const has = (text: string) => [...host!.querySelectorAll("h2")].some((h) => h.textContent === text);
const shows = (text: string) => host!.textContent!.includes(text);
const heading = (yearMonth: string) =>
  [...host!.querySelectorAll("h2")].find((h) => h.textContent === formatThaiMonth(yearMonth));
const headingTop = (scroller: HTMLElement, yearMonth: string) =>
  heading(yearMonth)!.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
// Real time: the iOS gesture tracking under test closes its momentum tail on a 150 ms timer.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A scroll to `top`, then enough frames for the virtualizer to read it back. */
async function scrollTo(scroller: HTMLElement, top: number) {
  scroller.scrollTop = top;
  await nextFrame();
  await sleep(50);
}

/** A finger: plain events carrying the one field the list's touch handlers read. */
function touch(target: EventTarget, type: string, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches: [{ clientY: y }] });
  target.dispatchEvent(event);
}

/** Finger down at `y0`, then to `y0 + travel` in steps, so the indicator sees every distance on the way. */
async function drag(scroller: HTMLElement, y0: number, travel: number, steps = 8) {
  touch(scroller, "touchstart", y0);
  for (let i = 1; i <= steps; i++) {
    touch(scroller, "touchmove", y0 + (travel * i) / steps);
    await nextFrame();
  }
}

const jumpFromTop = async (scroller: HTMLElement) => {
  await scrollTo(scroller, 0);
  expect(scroller.scrollTop).toBe(0);
};

describe("MonthList pull to load", () => {
  it("opens on seven months, not the months beyond", async () => {
    await mount();

    expect(has(formatThaiMonth(INITIAL))).toBe(true);
    expect(has(formatThaiMonth("2026-02"))).toBe(false);
    expect(has(formatThaiMonth("2026-10"))).toBe(false);
  });

  it("adds three older months after a pull at the top, once their Strokes are fetched", async () => {
    const { scroller } = await mount();
    await jumpFromTop(scroller);
    holding.add("2026-01");
    holding.add("2025-12");
    const before = headingTop(scroller, "2026-03");

    await drag(scroller, 100, 30);
    expect(shows(PROMPT_TOP)).toBe(true);
    await drag(scroller, 100, 90);
    expect(shows(RELEASE)).toBe(true);
    touch(scroller, "touchend");
    await expect.poll(() => shows(LOADING)).toBe(true);

    // Still fetching: nothing is added yet.
    await sleep(200);
    expect(has(formatThaiMonth("2026-02"))).toBe(false);
    expect(scroller.scrollTop).toBe(0);

    settle(["2026-01", "2025-12"], "resolve");
    await expect.poll(() => has(formatThaiMonth("2026-02"))).toBe(true);
    await expect.poll(() => shows(LOADING)).toBe(false);
    // The month being read has not moved.
    await expect.poll(() => headingTop(scroller, "2026-03")).toBeCloseTo(before, 0);
    expect(scroller.scrollTop).toBeGreaterThan(1000);

    await scrollTo(scroller, 0);
    for (const month of OLDER) expect(has(formatThaiMonth(month))).toBe(true);
  });

  it("keeps the list when a pull is released short of the threshold", async () => {
    const { scroller } = await mount();
    await jumpFromTop(scroller);

    await drag(scroller, 100, 30);
    touch(scroller, "touchend");

    await expect.poll(() => shows(PROMPT_TOP)).toBe(false);
    expect(shows(LOADING)).toBe(false);
    expect(has(formatThaiMonth("2026-02"))).toBe(false);
  });

  it("adds three newer months after a pull at the bottom", async () => {
    const { scroller } = await mount();
    await scrollTo(scroller, scroller.scrollHeight);
    holding.add("2026-11");
    holding.add("2026-12");

    await drag(scroller, 400, -30);
    expect(shows(PROMPT_BOTTOM)).toBe(true);
    await drag(scroller, 400, -90);
    expect(shows(RELEASE)).toBe(true);
    touch(scroller, "touchend");
    await expect.poll(() => shows(LOADING)).toBe(true);
    expect(has(formatThaiMonth("2026-10"))).toBe(false);

    settle(["2026-11", "2026-12"], "resolve");
    await expect.poll(() => shows(LOADING)).toBe(false);
    await scrollTo(scroller, scroller.scrollHeight);
    for (const month of NEWER) expect(has(formatThaiMonth(month))).toBe(true);
  });

  it("says so and adds nothing when the fetch fails", async () => {
    const { scroller } = await mount();
    await jumpFromTop(scroller);
    holding.add("2026-01");
    holding.add("2025-12");
    const height = scroller.scrollHeight;

    await drag(scroller, 100, 90);
    touch(scroller, "touchend");
    await expect.poll(() => shows(LOADING)).toBe(true);
    settle(["2026-01", "2025-12"], "reject");

    await expect.poll(() => shows(FAILED)).toBe(true);
    expect(scroller.scrollHeight).toBe(height);
    expect(has(formatThaiMonth("2026-02"))).toBe(false);
  });

  it("applies a prepend's scroll correction once the finger lifts, even if its Day cell unmounted mid-gesture", async () => {
    const { scroller } = await mount();
    await jumpFromTop(scroller);
    holding.add("2026-01");
    holding.add("2025-12");
    await drag(scroller, 100, 90);
    touch(scroller, "touchend");
    await expect.poll(() => shows(LOADING)).toBe(true);
    await sleep(200);

    // A second gesture starts on a Day cell of the first month and scrolls it out of the virtual window.
    const cell = host!.querySelector("[data-day-cell]")!;
    touch(cell, "touchstart", 300);
    for (let i = 0; i < 40; i++) {
      scroller.scrollTop += 50;
      await nextFrame();
    }
    await expect.poll(() => cell.isConnected).toBe(false);
    const rect = (h: Element) =>
      h.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const reading = [...host!.querySelectorAll("h2")].find((h) => rect(h) >= 0)!;
    const text = reading.textContent!;
    const readingOffset = rect(reading);

    // The months arrive mid-gesture, so the list holds the correction until the finger lifts. The
    // finger then lifts on the detached cell, so its touchend never reaches the scroller.
    const height = scroller.scrollHeight;
    settle(["2026-01", "2025-12"], "resolve");
    await expect.poll(() => shows(LOADING)).toBe(false);
    await sleep(300);
    touch(cell, "touchend");

    // Applied: the older months are in the scrollable height, and the month read has not moved.
    await expect
      .poll(() => scroller.scrollHeight, { timeout: 3000 })
      .toBeGreaterThan(height + 1000);
    await expect
      .poll(() => rect([...host!.querySelectorAll("h2")].find((h) => h.textContent === text)!))
      .toBeCloseTo(readingOffset, 0);
    await scrollTo(scroller, 0);
    expect(has(formatThaiMonth("2025-12"))).toBe(true);
  });
});
