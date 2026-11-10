import { describe, expect, it } from "vite-plus/test";

import { UNDO_LIMIT, UndoHistory } from "./undo";

describe("UndoHistory", () => {
  it("undoes newest first and redoes in reverse", () => {
    const h = new UndoHistory();
    h.record("a");
    h.record("b");
    expect(h.undo()).toBe("b");
    expect(h.undo()).toBe("a");
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toBe("a");
    expect(h.redo()).toBe("b");
    expect(h.redo()).toBeUndefined();
  });

  it("clears redo when a new Stroke is recorded", () => {
    const h = new UndoHistory();
    h.record("a");
    h.undo();
    expect(h.canRedo).toBe(true);
    h.record("b");
    expect(h.canRedo).toBe(false);
  });

  it("keeps at most 100 steps, dropping the oldest", () => {
    const h = new UndoHistory();
    for (let i = 0; i < UNDO_LIMIT + 1; i++) h.record(`s${i}`);
    const undone: string[] = [];
    for (let id = h.undo(); id !== undefined; id = h.undo()) undone.push(id);
    expect(undone).toHaveLength(UNDO_LIMIT);
    expect(undone.at(-1)).toBe("s1");
  });
});
