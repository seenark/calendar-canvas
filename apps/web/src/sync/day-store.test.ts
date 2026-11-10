import { describe, expect, it } from "vite-plus/test";

import { DayStore } from "./day-store";
import { confirmed, stroke } from "./fixtures";

const DAY = "2026-11-10";
const ids = (store: DayStore, day = DAY) => store.getSnapshot(day).strokes.map((s) => s.id);

describe("DayStore", () => {
  it("shows committed Strokes in drawing order", () => {
    const store = new DayStore();
    store.commitStroke(stroke("a"));
    store.commitStroke(stroke("b"));
    expect(ids(store)).toEqual(["a", "b"]);
  });

  it("undo hides the newest Stroke and redo brings it back in place", () => {
    const store = new DayStore();
    store.commitStroke(stroke("a"));
    store.commitStroke(stroke("b"));
    store.undo(DAY);
    expect(ids(store)).toEqual(["a"]);
    store.redo(DAY);
    expect(ids(store)).toEqual(["a", "b"]);
  });

  it("undoing an Eraser Stroke removes it from the picture and redo puts it back after the Pen Strokes it erased", () => {
    const store = new DayStore();
    store.commitStroke(stroke("pen"));
    store.commitStroke(stroke("eraser", "eraser"));
    store.undo(DAY);
    expect(ids(store)).toEqual(["pen"]);
    store.redo(DAY);
    expect(ids(store)).toEqual(["pen", "eraser"]);
  });

  it("a new Stroke ends the redo chain", () => {
    const store = new DayStore();
    store.commitStroke(stroke("a"));
    store.undo(DAY);
    expect(store.getSnapshot(DAY).canRedo).toBe(true);
    store.commitStroke(stroke("b"));
    expect(store.getSnapshot(DAY).canRedo).toBe(false);
    store.redo(DAY);
    expect(ids(store)).toEqual(["b"]);
  });

  it("reports availability and ignores undo and redo with nothing to do", () => {
    const store = new DayStore();
    expect(store.getSnapshot(DAY)).toMatchObject({ canUndo: false, canRedo: false });
    store.undo(DAY);
    store.redo(DAY);
    expect(store.getSnapshot(DAY).revision).toBe(0);
    store.commitStroke(stroke("a"));
    expect(store.getSnapshot(DAY)).toMatchObject({ canUndo: true, canRedo: false });
    store.undo(DAY);
    expect(store.getSnapshot(DAY)).toMatchObject({ canUndo: false, canRedo: true });
  });

  it("keeps 100 undo steps and leaves older Strokes in the picture", () => {
    const store = new DayStore();
    for (let i = 0; i < 101; i++) store.commitStroke(stroke(`s${i}`));
    for (let i = 0; i < 100; i++) store.undo(DAY);
    expect(store.getSnapshot(DAY).canUndo).toBe(false);
    expect(ids(store)).toEqual(["s0"]);
  });

  it("keeps Days apart", () => {
    const store = new DayStore();
    store.commitStroke(stroke("a", "pen", "2026-11-10"));
    store.commitStroke(stroke("b", "pen", "2026-11-11"));
    store.undo("2026-11-10");
    expect(ids(store, "2026-11-10")).toEqual([]);
    expect(ids(store, "2026-11-11")).toEqual(["b"]);
  });

  it("clearHistory drops undo and redo but keeps the Strokes", () => {
    const store = new DayStore();
    store.commitStroke(stroke("a"));
    store.commitStroke(stroke("b"));
    store.undo(DAY);
    store.clearHistory(DAY);
    expect(store.getSnapshot(DAY)).toMatchObject({ canUndo: false, canRedo: false });
    expect(ids(store)).toEqual(["a"]);
  });

  it("bumps the revision on every visible change and on none other", () => {
    const store = new DayStore();
    const revisions = [store.getSnapshot(DAY).revision];
    const seen = () => revisions.push(store.getSnapshot(DAY).revision);
    store.commitStroke(stroke("a"));
    seen();
    store.undo(DAY);
    seen();
    store.redo(DAY);
    seen();
    store.clearHistory(DAY);
    seen();
    expect(revisions).toEqual([0, 1, 2, 3, 3]);
  });

  it("changes the revision when the server deletes an old confirmed Stroke", () => {
    const store = new DayStore();
    const kept = confirmed("kept", 2);
    store.setConfirmed(DAY, [confirmed("old", 1), kept]);
    const before = store.getSnapshot(DAY).revision;
    store.setConfirmed(DAY, [kept]);
    expect(store.getSnapshot(DAY).revision).toBe(before + 1);
    expect(ids(store)).toEqual(["kept"]);
    store.setConfirmed(DAY, [kept]);
    expect(store.getSnapshot(DAY).revision).toBe(before + 1);
  });

  it("keeps the revision when a refetch returns equal Strokes as new objects or only receivedAt changes", () => {
    const store = new DayStore();
    store.setConfirmed(DAY, [confirmed("a", 1), confirmed("b", 2)]);
    const before = store.getSnapshot(DAY);
    store.setConfirmed(DAY, [confirmed("a", 1), confirmed("b", 2)]);
    store.setConfirmed(DAY, [
      { ...confirmed("a", 1), receivedAt: 99 },
      { ...confirmed("b", 2), receivedAt: 99 },
    ]);
    expect(store.getSnapshot(DAY)).toBe(before);
  });

  it("shows a Stroke once when a refetch confirms it while its add is still pending", () => {
    const store = new DayStore();
    store.commitStroke(stroke("a"));
    store.setConfirmed(DAY, [confirmed("a", 1)]);
    expect(ids(store)).toEqual(["a"]);
  });

  it("still redraws a Stroke on redo after its pending add and delete both left the pending list", () => {
    const store = new DayStore();
    store.commitStroke(stroke("a"));
    store.undo(DAY);
    store["days"].get(DAY)!.pending.length = 0;
    store.redo(DAY);
    expect(ids(store)).toEqual(["a"]);
  });

  it("notifies subscribers until they unsubscribe and gives a stable snapshot between changes", () => {
    const store = new DayStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.commitStroke(stroke("a"));
    expect(calls).toBe(1);
    expect(store.getSnapshot(DAY)).toBe(store.getSnapshot(DAY));
    unsubscribe();
    store.undo(DAY);
    expect(calls).toBe(1);
  });

  it("counts pending ops across Days and notifies when the count changes without a visible change", () => {
    const store = new DayStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.commitStroke(stroke("a"));
    store.undo(DAY);
    expect(store.pendingCount()).toBe(2);
    const snapshot = store.getSnapshot(DAY);
    calls = 0;
    store["days"].get(DAY)!.pending.length = 0;
    store.setConfirmed(DAY, []);
    expect(store.pendingCount()).toBe(0);
    expect(calls).toBe(1);
    expect(store.getSnapshot(DAY)).toBe(snapshot);
  });

  describe("sending", () => {
    it("hands each Pending op out once, with its Day, oldest first", () => {
      const store = new DayStore();
      store.commitStroke(stroke("a", "pen", "2026-11-09"));
      store.commitStroke(stroke("b"));
      store.undo(DAY);
      const sent = store.takeUnsent();
      expect(sent.map((o) => [o.op, o.day])).toEqual([
        ["add", "2026-11-09"],
        ["add", DAY],
        ["delete", DAY],
      ]);
      expect(store.takeUnsent()).toEqual([]);
      store.release(sent);
      expect(store.takeUnsent()).toHaveLength(3);
    });

    it("notifies Op listeners after each new Op", () => {
      const store = new DayStore();
      let calls = 0;
      store.subscribeOps(() => calls++);
      store.commitStroke(stroke("a"));
      store.undo(DAY);
      store.redo(DAY);
      expect(calls).toBe(3);
    });

    it("moves a Stroke from the Overlay to confirmed with its seq without changing the picture", () => {
      const store = new DayStore();
      store.commitStroke(stroke("a"));
      const before = store.getSnapshot(DAY);
      const sent = store.takeUnsent();
      const settled = store.settle(sent, [{ id: "a", seq: 5 }], 10);
      expect(settled.get(DAY)).toMatchObject([{ id: "a", seq: 5 }]);
      expect(store.getSnapshot(DAY)).toBe(before);
      expect(store.takeUnsent()).toEqual([]);
    });

    it("keeps Ops sent later in the Overlay while an earlier batch settles", () => {
      const store = new DayStore();
      store.commitStroke(stroke("a"));
      const first = store.takeUnsent();
      store.undo(DAY);
      expect(ids(store)).toEqual([]);
      store.settle(first, [{ id: "a", seq: 5 }], 10);
      expect(ids(store)).toEqual([]);
      store.settle(store.takeUnsent(), [{ id: "a" }], 11);
      expect(ids(store)).toEqual([]);
      store.redo(DAY);
      expect(ids(store)).toEqual(["a"]);
    });

    it("a delete the server reports missing leaves the Stroke out of the picture", () => {
      const store = new DayStore();
      store.commitStroke(stroke("b"));
      store.undo(DAY);
      store.settle(
        store.takeUnsent(),
        [
          { id: "b", seq: 2 },
          { id: "b", missing: true },
        ],
        10,
      );
      expect(ids(store)).toEqual([]);
    });

    it("rejects a response with the wrong number of results and keeps the Overlay", () => {
      const store = new DayStore();
      store.commitStroke(stroke("a"));
      expect(() => store.settle(store.takeUnsent(), [], 0)).toThrow(RangeError);
      expect(ids(store)).toEqual(["a"]);
    });

    it("keeps counting Ops in flight as pending until they settle", () => {
      const store = new DayStore();
      let calls = 0;
      store.commitStroke(stroke("a"));
      store.commitStroke(stroke("b"));
      const sent = store.takeUnsent();
      expect(store.pendingCount()).toBe(2);
      store.commitStroke(stroke("c"));
      expect(store.pendingCount()).toBe(3);
      store.subscribe(() => calls++);
      store.settle(
        sent,
        [
          { id: "a", seq: 1 },
          { id: "b", seq: 2 },
        ],
        10,
      );
      expect(store.pendingCount()).toBe(1);
      expect(calls).toBe(1);
      store.release(store.takeUnsent());
      expect(store.pendingCount()).toBe(1);
    });
  });

  describe("protectedIds", () => {
    it("names Strokes with Pending ops or an undo step, not settled ones", () => {
      const store = new DayStore();
      store.setConfirmed(DAY, [confirmed("old", 1)]);
      store.commitStroke(stroke("a"));
      store.commitStroke(stroke("b"));
      expect([...store.protectedIds(DAY)].sort()).toEqual(["a", "b"]);
      store.settle(
        store.takeUnsent(),
        [
          { id: "a", seq: 2 },
          { id: "b", seq: 3 },
        ],
        10,
      );
      expect([...store.protectedIds(DAY)].sort()).toEqual(["a", "b"]);
      store.clearHistory(DAY);
      expect(store.protectedIds(DAY).size).toBe(0);
      expect(store.confirmedStrokes(DAY).map((s) => s.id)).toEqual(["old", "a", "b"]);
    });
  });
});
