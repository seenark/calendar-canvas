import type { Stroke } from "@/drawing/stroke";

import { opStrokeId, type ConfirmedStroke, type PendingOp } from "./ops";

const NO_DELETED: ReadonlyMap<string, ConfirmedStroke> = new Map();

/**
 * The Day's picture. Confirmed Strokes in ascending `seq`, then the Overlay: ids whose last pending Op is
 * a `delete` are removed, ids whose last pending Op is a `restore` come back, pending adds are appended in
 * `localSeq` order. `deleted` is the session cache of Strokes the server has deleted, the only source of
 * their data for a restore.
 */
export function composeDay(
  confirmed: readonly ConfirmedStroke[],
  pending: readonly PendingOp[],
  deleted: ReadonlyMap<string, ConfirmedStroke> = NO_DELETED,
): Stroke[] {
  const ops = [...pending].sort((a, b) => a.localSeq - b.localSeq);
  const last = new Map<string, PendingOp["op"]>();
  for (const p of ops) last.set(opStrokeId(p), p.op);

  const base = [...confirmed];
  const present = new Set(base.map((s) => s.id));
  for (const [id, op] of last) {
    const stroke = deleted.get(id);
    if (op === "restore" && stroke && !present.has(id)) base.push(stroke);
  }
  base.sort((a, b) => a.seq - b.seq);

  const picture: Stroke[] = base.filter((s) => last.get(s.id) !== "delete");
  for (const p of ops) if (p.op === "add" && last.get(p.stroke.id) !== "delete") picture.push(p.stroke);
  return picture;
}
