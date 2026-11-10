export interface UpdateState {
  needRefresh: boolean;
  requested: boolean;
  pending: number;
  drawing: boolean;
  activated: boolean;
}

export type UpdateAction = "none" | "prompt" | "wait" | "activate" | "reload";

/** A client reloads only after its own User tap, with no Pending op and no Stroke in progress. */
export function decideUpdate(s: UpdateState): UpdateAction {
  if (!s.needRefresh) return "none";
  if (!s.requested) return "prompt";
  if (s.pending > 0 || s.drawing) return "wait";
  return s.activated ? "reload" : "activate";
}
