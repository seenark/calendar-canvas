import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vite-plus/test";

import { sharedMonthKey, type MonthStrokes } from "@/sync/queries";

import { createSharedSource } from "./calendar";

const stroke = (id: string, seq: number): MonthStrokes[string][number] => ({
  id,
  day: "2026-05-02",
  kind: "pen",
  color: "#000000",
  size: 3,
  points: [],
  hasPressure: false,
  bbox: [0, 0, 0, 0],
  createdAt: 0,
  seq,
  receivedAt: 0,
});

test("shared source serves one Owner's Days, with a revision per change", () => {
  const client = new QueryClient();
  const source = createSharedSource(client, "owner");
  const day = "2026-05-02";
  expect(source.getSnapshot(day).strokes).toEqual([]);

  client.setQueryData(sharedMonthKey("owner", "2026-05"), { [day]: [stroke("a", 1)] });
  const first = source.getSnapshot(day);
  expect(first.strokes).toHaveLength(1);
  expect(source.getSnapshot(day)).toBe(first);

  client.setQueryData(sharedMonthKey("owner", "2026-05"), {
    [day]: [stroke("a", 1), stroke("b", 2)],
  });
  expect(source.getSnapshot(day).revision).not.toBe(first.revision);

  client.setQueryData(sharedMonthKey("other", "2026-05"), { [day]: [stroke("c", 1)] });
  expect(source.getSnapshot(day).strokes).toHaveLength(2);
});

test("shared source notifies only for its Owner", () => {
  const client = new QueryClient();
  const source = createSharedSource(client, "owner");
  let calls = 0;
  const off = source.subscribe(() => calls++);
  client.setQueryData(sharedMonthKey("other", "2026-05"), {});
  expect(calls).toBe(0);
  client.setQueryData(sharedMonthKey("owner", "2026-05"), {});
  expect(calls).toBeGreaterThan(0);
  off();
});
