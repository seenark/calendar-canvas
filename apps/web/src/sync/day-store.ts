import type { Stroke } from "@/drawing/stroke";

import { composeDay } from "./compose";
import type { ConfirmedStroke, Op, PendingOp } from "./ops";
import { UndoHistory } from "./undo";

export type DaySnapshot = {
  /** Increments whenever the Day's visible Strokes change. */
  revision: number;
  strokes: readonly Stroke[];
  canUndo: boolean;
  canRedo: boolean;
};

type DayState = {
  confirmed: ConfirmedStroke[];
  pending: PendingOp[];
  /** Every Stroke this Day has held, kept for the session so a restore can redraw one that left the picture by any path. */
  seen: Map<string, Stroke>;
  /** Ids and kinds of the composed picture, in order. Revision follows this, not object identity. */
  key: string[];
  history: UndoHistory;
  snapshot: DaySnapshot;
};

/** Framework-free state per Day. `subscribe` and `getSnapshot(day)` fit `useSyncExternalStore`. */
export class DayStore {
  private readonly days = new Map<string, DayState>();
  private readonly listeners = new Set<() => void>();
  private localSeq = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot(day: string): DaySnapshot {
    return this.state(day).snapshot;
  }

  /** The Stroke becomes a pending `add` and the newest undo step. */
  commitStroke(stroke: Stroke): void {
    const s = this.state(stroke.day);
    s.seen.set(stroke.id, stroke);
    this.push(s, { op: "add", stroke });
    s.history.record(stroke.id);
    this.refresh(stroke.day);
  }

  undo(day: string): void {
    const s = this.state(day);
    const id = s.history.undo();
    if (id === undefined) return;
    this.push(s, { op: "delete", id });
    this.refresh(day);
  }

  redo(day: string): void {
    const s = this.state(day);
    const id = s.history.redo();
    if (id === undefined) return;
    this.push(s, { op: "restore", id });
    this.refresh(day);
  }

  clearHistory(day: string): void {
    const s = this.state(day);
    s.history = new UndoHistory();
    this.refresh(day);
  }

  /** Replaces the Day's confirmed Strokes. */
  setConfirmed(day: string, confirmed: ConfirmedStroke[]): void {
    const s = this.state(day);
    for (const c of confirmed) s.seen.set(c.id, c);
    s.confirmed = confirmed;
    this.refresh(day);
  }

  private state(day: string): DayState {
    let s = this.days.get(day);
    if (!s) {
      s = {
        confirmed: [],
        pending: [],
        seen: new Map(),
        key: [],
        history: new UndoHistory(),
        snapshot: { revision: 0, strokes: [], canUndo: false, canRedo: false },
      };
      this.days.set(day, s);
    }
    return s;
  }

  private push(s: DayState, op: Op): void {
    s.pending.push({ ...op, localSeq: this.localSeq++ });
  }

  private refresh(day: string): void {
    const s = this.state(day);
    const strokes = composeDay(s.confirmed, s.pending, s.seen);
    const key = strokes.map((stroke) => `${stroke.id}:${stroke.kind}`);
    const changed = key.length !== s.key.length || key.some((k, i) => k !== s.key[i]);
    s.key = key;
    const { canUndo, canRedo } = s.history;
    if (!changed && canUndo === s.snapshot.canUndo && canRedo === s.snapshot.canRedo) return;
    s.snapshot = {
      revision: s.snapshot.revision + (changed ? 1 : 0),
      strokes: changed ? strokes : s.snapshot.strokes,
      canUndo,
      canRedo,
    };
    for (const listener of this.listeners) listener();
  }
}

export const dayStore = new DayStore();
