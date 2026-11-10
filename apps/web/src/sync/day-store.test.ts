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
});
