import type { OpResult } from "@/api/types";
import type { Stroke } from "@/drawing/stroke";

import { applyResults } from "./apply";
import { composeDay } from "./compose";
import type { ConfirmedStroke, Op, PendingOp, SentOp } from "./ops";
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
  private readonly opListeners = new Set<() => void>();
  /** `localSeq` of Pending ops handed to the network and not yet settled or released. They stay in the Overlay meanwhile. */
  private readonly inflight = new Set<number>();
  private localSeq = 0;
  private notifiedPending = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called after every new Op, so a sender can flush. */
  subscribeOps = (listener: () => void): (() => void) => {
    this.opListeners.add(listener);
    return () => this.opListeners.delete(listener);
  };

  getSnapshot(day: string): DaySnapshot {
    return this.state(day).snapshot;
  }

  /** Pending ops across all Days. Subscribers are also notified when this changes. */
  pendingCount = (): number => {
    let n = 0;
    for (const s of this.days.values()) n += s.pending.length;
    return n;
  };

  /** The Stroke becomes a pending `add` and the newest undo step. */
  commitStroke(stroke: Stroke): void {
    const s = this.state(stroke.day);
    s.seen.set(stroke.id, stroke);
    this.push(s, { op: "add", stroke });
    s.history.record(stroke.id);
    this.refresh(stroke.day);
    this.emitOp();
  }

  undo(day: string): void {
    const s = this.state(day);
    const id = s.history.undo();
    if (id === undefined) return;
    this.push(s, { op: "delete", id });
    this.refresh(day);
    this.emitOp();
  }

  redo(day: string): void {
    const s = this.state(day);
    const id = s.history.redo();
    if (id === undefined) return;
    this.push(s, { op: "restore", id });
    this.refresh(day);
    this.emitOp();
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

  /** Pending ops not yet in flight, oldest first. They count as in flight until `settle` or `release`. */
  takeUnsent(): SentOp[] {
    const out: SentOp[] = [];
    for (const [day, s] of this.days)
      for (const p of s.pending) if (!this.inflight.has(p.localSeq)) out.push({ ...p, day });
    out.sort((a, b) => a.localSeq - b.localSeq);
    for (const op of out) this.inflight.add(op.localSeq);
    return out;
  }

  /** Returns Ops of a failed send to the unsent set. */
  release(sent: readonly SentOp[]): void {
    for (const op of sent) this.inflight.delete(op.localSeq);
  }

  /**
   * Applies the server's answer to `sent`: the Ops leave the Overlay and their effect enters the confirmed
   * layer in one refresh per Day, so the picture never shows a gap. Returns each touched Day's confirmed Strokes.
   */
  settle(
    sent: readonly SentOp[],
    results: readonly OpResult[],
    receivedAt: number,
  ): Map<string, ConfirmedStroke[]> {
    if (results.length !== sent.length)
      throw new RangeError(`Server answered ${results.length} results for ${sent.length} ops`);
    const byDay = new Map<string, { ops: SentOp[]; results: OpResult[] }>();
    sent.forEach((op, i) => {
      const group = byDay.get(op.day) ?? { ops: [], results: [] };
      group.ops.push(op);
      group.results.push(results[i]!);
      byDay.set(op.day, group);
    });
    const settled = new Map<string, ConfirmedStroke[]>();
    for (const [day, group] of byDay) {
      const s = this.state(day);
      s.confirmed = applyResults(s.confirmed, group.ops, group.results, s.seen, receivedAt);
      for (const c of s.confirmed) s.seen.set(c.id, c);
      const done = new Set(group.ops.map((op) => op.localSeq));
      s.pending = s.pending.filter((p) => !done.has(p.localSeq));
      for (const seq of done) this.inflight.delete(seq);
      settled.set(day, s.confirmed);
      this.refresh(day);
    }
    return settled;
  }

  private emitOp(): void {
    for (const listener of this.opListeners) listener();
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
    const pending = this.pendingCount();
    const pendingChanged = pending !== this.notifiedPending;
    this.notifiedPending = pending;
    const snapshotChanged =
      changed || canUndo !== s.snapshot.canUndo || canRedo !== s.snapshot.canRedo;
    if (!snapshotChanged && !pendingChanged) return;
    if (snapshotChanged) {
      s.snapshot = {
        revision: s.snapshot.revision + (changed ? 1 : 0),
        strokes: changed ? strokes : s.snapshot.strokes,
        canUndo,
        canRedo,
      };
    }
    for (const listener of this.listeners) listener();
  }
}

export const dayStore = new DayStore();
