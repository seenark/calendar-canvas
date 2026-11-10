import type { Stroke } from "@/drawing/stroke";

import { opStrokeId, type ConfirmedStroke, type PendingOp } from "./ops";

const NO_SEEN: ReadonlyMap<string, Stroke> = new Map();

type Placed = { stroke: Stroke; group: 0 | 1; at: number };

/**
 * The Day's picture, each Stroke id once. Confirmed Strokes come first in ascending `seq`, then Strokes only
 * the client knows (pending adds, or a restore of a Stroke the server never confirmed) in local order. A
 * pending add for an id that is already confirmed is ignored, and repeated adds keep the first one's place.
 * Then the Overlay applies: ids whose last pending Op is a `delete` are removed, ids whose last pending Op
 * is a `restore` come back. `seen` is the session cache of every Stroke the Day store has held, the only
 * source of data for a restore of a Stroke that is no longer confirmed or pending.
 */
export function composeDay(
  confirmed: readonly ConfirmedStroke[],
  pending: readonly PendingOp[],
  seen: ReadonlyMap<string, Stroke> = NO_SEEN,
): Stroke[] {
  const ops = [...pending].sort((a, b) => a.localSeq - b.localSeq);
  const last = new Map<string, PendingOp>();
  for (const p of ops) last.set(opStrokeId(p), p);

  const placed = new Map<string, Placed>();
  for (const c of confirmed)
    if (!placed.has(c.id)) placed.set(c.id, { stroke: c, group: 0, at: c.seq });
  for (const p of ops)
    if (p.op === "add" && !placed.has(p.stroke.id))
      placed.set(p.stroke.id, { stroke: p.stroke, group: 1, at: p.localSeq });
  for (const [id, p] of last) {
    const stroke = seen.get(id);
    if (p.op !== "restore" || !stroke || placed.has(id)) continue;
    placed.set(
      id,
      "seq" in stroke
        ? { stroke, group: 0, at: (stroke as ConfirmedStroke).seq }
        : { stroke, group: 1, at: p.localSeq },
    );
  }

  return [...placed.values()]
    .filter((e) => last.get(e.stroke.id)?.op !== "delete")
    .sort((a, b) => a.group - b.group || a.at - b.at)
    .map((e) => e.stroke);
}
