import { Button } from "@calendar-canvas/ui/components/button";
import { useRouter } from "@tanstack/react-router";
import { getDefaultStore } from "jotai/vanilla";
import { ArrowLeft } from "lucide-react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { DrawingEngine } from "@/drawing/engine";
import { SaveStatus } from "@/drawing/save-status";
import { Toolbar } from "@/drawing/toolbar/toolbar";
import { DAY_ASPECT } from "@/ink/constants";
import { formatThaiDate, monthOfDay, parseDay } from "@/lib/date";
import { dayLayoutId, isDayCellOnScreen } from "@/month/day-cell";
import { usePruning } from "@/pruning/trigger";
import { toolAtom } from "@/state/tool";
import { dayStore } from "@/sync/day-store";
import { useMonths } from "@/sync/queries";
import { CellThumbnailCopy, Thumbnail } from "@/thumbnails/thumbnail";

/** Longest the engine waits for the expand animation before it mounts anyway. */
const EXPAND_TIMEOUT_MS = 1000;

const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

/**
 * The Day's paper shares a layout with its Day cell. While it expands the paper shows the Day cell's
 * bitmap stretched to the paper, then the sharper paper-size thumbnail once the worker delivers it, and
 * the DrawingEngine mounts once the expand animation ends. Without a Day cell the paper fades like the rest.
 */
export function DrawingPage({ date }: { date: string }) {
  const router = useRouter();
  useMonths([monthOfDay(date)]);
  const reducedMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const paperRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [paperWidth, setPaperWidth] = useState(0);
  usePruning(date, surfaceRef);
  const [shared] = useState(() => !reducedMotion && isDayCellOnScreen(date));
  const [ready, setReady] = useState(!shared);
  const [drawn, setDrawn] = useState(false);
  const canUndo = useSyncExternalStore(
    dayStore.subscribe,
    () => dayStore.getSnapshot(date).canUndo,
  );
  const canRedo = useSyncExternalStore(
    dayStore.subscribe,
    () => dayStore.getSnapshot(date).canRedo,
  );

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setReady(true), EXPAND_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useLayoutEffect(() => {
    if (!ready) return;
    const store = getDefaultStore();
    store.set(toolAtom, "pen");
    const engine = new DrawingEngine({
      container: surfaceRef.current!,
      store,
      day: date,
      onCommit: (stroke) => dayStore.commitStroke(stroke),
    });
    let revision = -1;
    const sync = () => {
      const snapshot = dayStore.getSnapshot(date);
      if (snapshot.revision === revision) return;
      revision = snapshot.revision;
      engine.setStrokes(snapshot.strokes);
    };
    const unsubscribe = dayStore.subscribe(sync);
    sync();
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => {
      cancelAnimationFrame(frame);
      engine.destroy();
      unsubscribe();
      dayStore.clearHistory(date);
    };
  }, [date, ready]);

  useEffect(() => {
    const paper = paperRef.current!;
    const observer = new ResizeObserver(() => setPaperWidth(paper.clientWidth));
    observer.observe(paper);
    return () => observer.disconnect();
  }, []);

  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else
      router.navigate({
        to: "/m/$yearMonth",
        params: { yearMonth: monthOfDay(date) },
        replace: true,
      });
  };

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <motion.div className="bg-background absolute inset-0 -z-10" {...FADE} />
      <motion.header className="flex h-12 shrink-0 items-center gap-2 px-2" {...FADE}>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          aria-label="กลับ"
          onClick={goBack}
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-sm font-bold">{formatThaiDate(parseDay(date)!)}</h1>
        <SaveStatus />
      </motion.header>
      <div className="grid min-h-0 flex-1 place-items-center [container-type:size]">
        <motion.div
          ref={paperRef}
          layoutId={shared ? dayLayoutId(date) : undefined}
          onLayoutAnimationComplete={() => setReady(true)}
          className="bg-paper relative overflow-hidden"
          style={{
            width: `min(100cqw, calc(100cqh / ${DAY_ASPECT}))`,
            aspectRatio: `1 / ${DAY_ASPECT}`,
          }}
          {...(shared ? {} : FADE)}
        >
          {!drawn && shared && <CellThumbnailCopy day={date} />}
          {!drawn && <Thumbnail day={date} />}
          <div
            ref={surfaceRef}
            className="absolute inset-0 touch-none"
            style={{ pointerEvents: ready && isPresent ? "auto" : "none" }}
          />
        </motion.div>
      </div>
      <motion.div {...FADE}>
        <Toolbar
          paperWidth={paperWidth}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => dayStore.undo(date)}
          onRedo={() => dayStore.redo(date)}
        />
      </motion.div>
    </div>
  );
}
