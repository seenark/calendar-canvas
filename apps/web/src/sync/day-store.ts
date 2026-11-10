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
  /** Full data of Strokes the server deleted, kept for the session so a restore can redraw them. */
  deleted: Map<string, ConfirmedStroke>;
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

  /** Replaces the Day's confirmed Strokes. Ids that left the list were deleted by the server and move to the cache. */
  setConfirmed(day: string, confirmed: ConfirmedStroke[]): void {
    const s = this.state(day);
    const kept = new Set(confirmed.map((c) => c.id));
    for (const old of s.confirmed) if (!kept.has(old.id)) s.deleted.set(old.id, old);
    for (const id of kept) s.deleted.delete(id);
    s.confirmed = confirmed;
    this.refresh(day);
  }

  private state(day: string): DayState {
    let s = this.days.get(day);
    if (!s) {
      s = {
        confirmed: [],
        pending: [],
        deleted: new Map(),
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
    const strokes = composeDay(s.confirmed, s.pending, s.deleted);
    const changed =
      strokes.length !== s.snapshot.strokes.length ||
      strokes.some((stroke, i) => stroke !== s.snapshot.strokes[i]);
    s.snapshot = {
      revision: s.snapshot.revision + (changed ? 1 : 0),
      strokes: changed ? strokes : s.snapshot.strokes,
      canUndo: s.history.canUndo,
      canRedo: s.history.canRedo,
    };
    for (const listener of this.listeners) listener();
  }
}

export const dayStore = new DayStore();
