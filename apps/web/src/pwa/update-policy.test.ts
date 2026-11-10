import { describe, expect, it } from "vite-plus/test";

import { decideUpdate, whenActivated, type UpdateState } from "./update-policy";

const base: UpdateState = {
  needRefresh: true,
  requested: false,
  pending: 0,
  drawing: false,
  activated: false,
};

describe("decideUpdate", () => {
  it("does nothing without a waiting build", () => {
    expect(decideUpdate({ ...base, needRefresh: false, requested: true })).toBe("none");
  });

  it("only prompts until the User taps, even when the new build already controls the page", () => {
    expect(decideUpdate(base)).toBe("prompt");
    expect(decideUpdate({ ...base, activated: true })).toBe("prompt");
  });

  it("defers a requested update while Pending ops exist or a Stroke is in progress", () => {
    expect(decideUpdate({ ...base, requested: true, pending: 2 })).toBe("wait");
    expect(decideUpdate({ ...base, requested: true, drawing: true })).toBe("wait");
    expect(decideUpdate({ ...base, requested: true, activated: true, pending: 1 })).toBe("wait");
  });

  it("activates the waiting build once both are clear, then reloads when it controls the page", () => {
    expect(decideUpdate({ ...base, requested: true })).toBe("activate");
    expect(decideUpdate({ ...base, requested: true, activated: true })).toBe("reload");
  });

  it("cancel resets the request back to the prompt", () => {
    const waiting = { ...base, requested: true, pending: 1 };
    expect(decideUpdate(waiting)).toBe("wait");
    expect(decideUpdate({ ...waiting, requested: false })).toBe("prompt");
  });
});

function fakeWorker(state: string) {
  const worker = Object.assign(new EventTarget(), { state });
  const move = (next: string) => {
    worker.state = next;
    worker.dispatchEvent(new Event("statechange"));
  };
  return { worker: worker as unknown as ServiceWorker, move };
}

describe("whenActivated", () => {
  it("settles from the worker state alone, as an uncontrolled page gets no controllerchange", async () => {
    const { worker, move } = fakeWorker("installed");
    let activated = false;
    const done = whenActivated(worker).then(() => (activated = true));
    move("activating");
    await Promise.resolve();
    expect(activated).toBe(false);
    move("activated");
    await done;
    expect(activated).toBe(true);
  });

  it("settles at once when another tab already activated the worker", async () => {
    await expect(whenActivated(fakeWorker("activated").worker)).resolves.toBeUndefined();
  });

  it("rejects when a newer build supersedes the worker", async () => {
    const { worker, move } = fakeWorker("installed");
    const done = whenActivated(worker);
    move("redundant");
    await expect(done).rejects.toThrow("superseded");
  });
});
