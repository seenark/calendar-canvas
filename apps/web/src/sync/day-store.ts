import type { OpResult } from "@/api/types";
import type { Stroke } from "@/drawing/stroke";

import { applyResults } from "./apply";
import { composeDay } from "./compose";
import { opStrokeId, type ConfirmedStroke, type Op, type PendingOp, type SentOp } from "./ops";
import { UndoHistory } from "./undo";

export type DaySnapshot = {
  /** Increments whenever the Day's visible Strokes change. */
  revision: number;
  strokes: readonly Stroke[];
  canUndo: boolean;
  canRedo: boolean;
};

/** The Pending ops that must survive a reload, and the Strokes their `delete` and `restore` Ops name. Plain data. */
export type PendingSnapshot = { ops: SentOp[]; strokes: Stroke[] };

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

  /** The Day's server-confirmed Strokes in ascending `seq`, whatever the Overlay does to them. */
  confirmedStrokes(day: string): readonly ConfirmedStroke[] {
    return this.state(day).confirmed;
  }

  /** Ids the Day's Pending ops or undo and redo stacks name. Pruning must leave these alone. */
  protectedIds(day: string): Set<string> {
    const s = this.state(day);
    return new Set([...s.pending.map(opStrokeId), ...s.history.ids()]);
  }

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
    const out = this.pendingOps().filter((op) => !this.inflight.has(op.localSeq));
    for (const op of out) this.inflight.add(op.localSeq);
    return out;
  }

  /** Every Pending op, in flight or not, oldest first, with the Strokes a `delete` or `restore` of them needs to be redrawn. */
  snapshotPending(): PendingSnapshot {
    const ops = this.pendingOps();
    const added = new Set(ops.flatMap((op) => (op.op === "add" ? [op.stroke.id] : [])));
    const strokes: Stroke[] = [];
    for (const op of ops) {
      if (op.op === "add" || added.has(op.id)) continue;
      const stroke = this.days.get(op.day)?.seen.get(op.id);
      if (stroke) strokes.push(stroke);
      added.add(op.id);
    }
    return { ops, strokes };
  }

  /**
   * Puts Pending ops of an earlier session back into the Overlay. An Op already held keeps its place. `inflight`
   * marks them as handed to a mutation that will `settle` or `release` them.
   */
  restore({ ops, strokes }: PendingSnapshot, inflight = false): void {
    for (const stroke of strokes) this.state(stroke.day).seen.set(stroke.id, stroke);
    const days = new Set<string>();
    for (const op of ops) {
      const s = this.state(op.day);
      if (!s.pending.some((p) => p.localSeq === op.localSeq)) s.pending.push(op);
      if (op.op === "add") s.seen.set(op.stroke.id, op.stroke);
      if (inflight) this.inflight.add(op.localSeq);
      this.localSeq = Math.max(this.localSeq, op.localSeq + 1);
      days.add(op.day);
    }
    for (const day of days) this.refresh(day);
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

  private pendingOps(): SentOp[] {
    const out: SentOp[] = [];
    for (const [day, s] of this.days) for (const p of s.pending) out.push({ ...p, day });
    return out.sort((a, b) => a.localSeq - b.localSeq);
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
