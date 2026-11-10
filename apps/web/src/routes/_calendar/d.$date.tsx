import { Button } from "@calendar-canvas/ui/components/button";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { getDefaultStore } from "jotai/vanilla";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DrawingEngine } from "@/drawing/engine";
import { addDayStroke, getDayStrokes } from "@/drawing/memory-store";
import { Toolbar } from "@/drawing/toolbar/toolbar";
import { DAY_ASPECT } from "@/ink/constants";
import { formatThaiDate, monthOfDay, parseDay } from "@/lib/date";
import { toolAtom } from "@/state/tool";

export const Route = createFileRoute("/_calendar/d/$date")({
  beforeLoad: ({ params }) => {
    if (!parseDay(params.date)) throw redirect({ to: "/", replace: true });
  },
  component: DrawingPage,
});

function DrawingPage() {
  const { date } = Route.useParams();
  const router = useRouter();
  const paperRef = useRef<HTMLDivElement>(null);
  const [paperWidth, setPaperWidth] = useState(0);

  useEffect(() => {
    const store = getDefaultStore();
    store.set(toolAtom, "pen");
    const engine = new DrawingEngine({
      container: paperRef.current!,
      store,
      day: date,
      onCommit: addDayStroke,
    });
    engine.setStrokes(getDayStrokes(date));
    return () => engine.destroy();
  }, [date]);

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
    <div className="bg-background fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="flex h-12 shrink-0 items-center gap-2 px-2">
        <Button variant="ghost" size="icon-lg" aria-label="กลับ" onClick={goBack}>
          <ArrowLeft />
        </Button>
        <h1 className="text-sm font-bold">{formatThaiDate(parseDay(date)!)}</h1>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center [container-type:size]">
        <div
          ref={paperRef}
          className="bg-paper relative touch-none"
          style={{
            width: `min(100cqw, calc(100cqh / ${DAY_ASPECT}))`,
            aspectRatio: `1 / ${DAY_ASPECT}`,
          }}
        />
      </div>
      <Toolbar paperWidth={paperWidth} />
    </div>
  );
}
