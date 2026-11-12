import { Loader2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@calendar-canvas/ui/lib/utils";

import { PULL_THRESHOLD, type PullEdge, type PullState } from "./use-pull-to-load";

const PROMPT: Record<PullEdge, string> = {
  top: "ดึงเพื่อโหลดเดือนก่อนหน้า",
  bottom: "ดึงเพื่อโหลดเดือนถัดไป",
};

const LOADING = "กำลังโหลด…";

function Loading() {
  return (
    <>
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {LOADING}
    </>
  );
}

function noteFor(state: PullState, edge: PullEdge): ReactNode {
  if (state.phase === "idle" || state.edge !== edge) return null;
  switch (state.phase) {
    case "pulling":
      return state.distance >= PULL_THRESHOLD ? "ปล่อยเพื่อโหลด" : PROMPT[edge];
    case "loading":
      return <Loading />;
    case "failed":
      return "โหลดไม่สำเร็จ ดึงเพื่อลองใหม่";
  }
}

/**
 * What the list says at its edges while a pull runs or a load fails, and, at the top, while months
 * jumped to are still loading (`rangeLoading`). Overlays the scroller; never takes touches.
 */
export function PullIndicator({
  state,
  rangeLoading,
}: {
  state: PullState;
  rangeLoading: boolean;
}) {
  const top = noteFor(state, "top") ?? (rangeLoading ? <Loading /> : null);
  const bottom = noteFor(state, "bottom");
  // The note follows the finger at half speed; reduced motion keeps it still.
  const shift = state.phase === "pulling" ? Math.round(state.distance / 2) : 0;

  return (
    <>
      {top && (
        <Note edge="top" shift={state.phase === "pulling" && state.edge === "top" ? shift : 0}>
          {top}
        </Note>
      )}
      {bottom && (
        <Note edge="bottom" shift={state.phase === "pulling" ? -shift : 0}>
          {bottom}
        </Note>
      )}
    </>
  );
}

function Note({ edge, shift, children }: { edge: PullEdge; shift: number; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-none absolute inset-x-0 flex justify-center",
        edge === "top" ? "top-2" : "bottom-2",
      )}
    >
      <span
        className="paper-shadow inline-block translate-y-(--shift) motion-reduce:translate-y-0"
        style={{ "--shift": `${shift}px` } as CSSProperties}
      >
        <span className="paper-tag flex items-center gap-2 text-sm font-bold">{children}</span>
      </span>
    </div>
  );
}
