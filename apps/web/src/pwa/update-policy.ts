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

/**
 * Settles with the worker's own state, because a page that was not controlled when it loaded never gets
 * `controllerchange` when the worker activates. Rejects when a newer build supersedes the worker first.
 */
export function whenActivated(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = () => {
      if (worker.state === "activated") resolve();
      else if (worker.state === "redundant") reject(new Error("service worker superseded"));
      else return;
      worker.removeEventListener("statechange", settle);
    };
    worker.addEventListener("statechange", settle);
    settle();
  });
}
