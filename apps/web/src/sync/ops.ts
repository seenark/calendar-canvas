import type { Stroke } from "@/drawing/stroke";

export type Op =
  | { op: "add"; stroke: Stroke }
  | { op: "delete"; id: string }
  | { op: "restore"; id: string };

/** An Op not yet confirmed by the server. `localSeq` is a client-local, monotonic creation order. */
export type PendingOp = Op & { localSeq: number };

/** A Stroke the server has accepted. Only `seq` orders confirmed Strokes; client time never does. */
export type ConfirmedStroke = Stroke & { seq: number; receivedAt: number };

export const opStrokeId = (op: Op): string => (op.op === "add" ? op.stroke.id : op.id);

/** A Pending op handed to the network, with its Day (a `delete` or `restore` names only an id). Plain data, so it survives JSON. */
export type SentOp = PendingOp & { day: string };
