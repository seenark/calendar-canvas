import type { OpResult } from "@/api/types";
import type { Stroke } from "@/drawing/stroke";

import { opStrokeId, type ConfirmedStroke, type SentOp } from "./ops";

/**
 * A Day's confirmed Strokes after the server answered `sent` (one result per Op, in order). An `add` becomes a
 * confirmed Stroke with the server's `seq`. A `delete` drops the id and a `restore` brings it back, from `seen`
 * or from an `add` earlier in the batch. A `missing` result means the server does not know the id, so it is
 * dropped. `receivedAt` is the client's clock: the server does not return it for an add, and the next refetch
 * replaces it.
 */
export function applyResults(
  confirmed: readonly ConfirmedStroke[],
  sent: readonly SentOp[],
  results: readonly OpResult[],
  seen: ReadonlyMap<string, Stroke>,
  receivedAt: number,
): ConfirmedStroke[] {
  const byId = new Map(confirmed.map((c) => [c.id, c]));
  const learned = new Map<string, ConfirmedStroke>();
  sent.forEach((op, i) => {
    const result = results[i]!;
    const id = opStrokeId(op);
    if (result.missing) {
      byId.delete(id);
    } else if (op.op === "add") {
      if (result.seq === undefined) throw new RangeError(`Server confirmed add ${id} without a seq`);
      const c = { ...op.stroke, seq: result.seq, receivedAt };
      learned.set(id, c);
      byId.set(id, c);
    } else if (op.op === "delete") {
      byId.delete(id);
    } else {
      const known = learned.get(id) ?? seen.get(id);
      if (known && "seq" in known) byId.set(id, known as ConfirmedStroke);
    }
  });
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}
