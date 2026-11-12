import { type RefObject, useEffect, useEffectEvent, useRef, useState } from "react";

/** How far, in px, a pull has to go before releasing loads. */
export const PULL_THRESHOLD = 64;
/** The distance `PullState` reports stops here; the indicator needs no more. */
const MAX_DISTANCE = 96;

export type PullEdge = "top" | "bottom";

export type PullState =
  | { phase: "idle" }
  | { phase: "pulling"; edge: PullEdge; distance: number }
  | { phase: "loading"; edge: PullEdge }
  | { phase: "failed"; edge: PullEdge };

const IDLE: PullState = { phase: "idle" };

/**
 * Pull-to-load at both ends of the scroller: a finger that keeps moving past the top (down) or the
 * bottom (up) edge. `load` runs when the finger lifts past `PULL_THRESHOLD`; if it rejects the state
 * becomes `failed` until the next pull. `reset` abandons a pull or a load still running.
 */
export function usePullToLoad(
  scrollRef: RefObject<HTMLElement | null>,
  {
    canLoad,
    load,
  }: { canLoad: (edge: PullEdge) => boolean; load: (edge: PullEdge) => Promise<void> },
): { state: PullState; reset: () => void } {
  const [state, setState] = useState<PullState>(IDLE);
  const stateRef = useRef<PullState>(IDLE);
  const generation = useRef(0);
  const canLoadNow = useEffectEvent(canLoad);
  const loadNow = useEffectEvent(load);

  const set = (next: PullState) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    const el = scrollRef.current!;
    let edge: PullEdge | null = null;
    // While no pull runs, the previous touchmove's y; during one, where it began.
    let anchorY = 0;
    let lastY = 0;

    const atTop = () => el.scrollTop <= 0;
    // Month heights are fractional and WebKit floors scrollTop.
    const atBottom = () => el.scrollTop >= el.scrollHeight - el.clientHeight - 1;

    const onStart = (event: TouchEvent) => {
      edge = null;
      lastY = anchorY = event.touches[0]!.clientY;
    };

    const onMove = (event: TouchEvent) => {
      const y = event.touches[0]!.clientY;
      if (stateRef.current.phase === "loading") {
        lastY = y;
        return;
      }
      if (edge === null) {
        const dy = y - lastY;
        const wanted = dy > 0 && atTop() ? "top" : dy < 0 && atBottom() ? "bottom" : null;
        if (wanted !== null && canLoadNow(wanted)) {
          edge = wanted;
          anchorY = lastY;
        }
        lastY = y;
        if (edge === null) return;
      }
      const distance = edge === "top" ? y - anchorY : anchorY - y;
      if (distance <= 0) {
        edge = null;
        if (stateRef.current.phase === "pulling") set(IDLE);
        return;
      }
      // The pull is ours: without this iOS rubber-bands the whole list instead.
      if (event.cancelable) event.preventDefault();
      set({ phase: "pulling", edge, distance: Math.min(Math.round(distance), MAX_DISTANCE) });
    };

    const onEnd = () => {
      edge = null;
      const current = stateRef.current;
      if (current.phase !== "pulling") return;
      if (current.distance < PULL_THRESHOLD) {
        set(IDLE);
        return;
      }
      const token = ++generation.current;
      set({ phase: "loading", edge: current.edge });
      loadNow(current.edge).then(
        () => {
          if (token === generation.current) set(IDLE);
        },
        () => {
          if (token === generation.current) set({ phase: "failed", edge: current.edge });
        },
      );
    };

    const onCancel = () => {
      edge = null;
      if (stateRef.current.phase === "pulling") set(IDLE);
    };

    // A failure note belongs to its edge; once the list is scrolled away from it, it is stale.
    const onScroll = () => {
      const current = stateRef.current;
      if (current.phase !== "failed") return;
      if (!(current.edge === "top" ? atTop() : atBottom())) set(IDLE);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      el.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef]);

  const reset = () => {
    generation.current++;
    set(IDLE);
  };

  return { state, reset };
}
