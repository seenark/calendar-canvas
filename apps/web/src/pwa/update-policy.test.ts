import { describe, expect, it } from "vite-plus/test";

import { decideUpdate, type UpdateState } from "./update-policy";

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
