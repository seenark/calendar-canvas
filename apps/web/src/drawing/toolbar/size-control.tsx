import { cn } from "@calendar-canvas/ui/lib/utils";
import { useAtom, useAtomValue } from "jotai/react";
import { useRef, useState, type PointerEvent } from "react";

import { SIZE_PRESETS, sizeFromDrag } from "@/drawing/sizes";
import type { StrokeKind } from "@/drawing/stroke";
import { eraserAtom, penAtom, toolAtom } from "@/state/tool";

const LONG_PRESS_MS = 350;
const TAP_SLOP_PX = 10;
/** shortcut: the dot is capped at the 44px target, so the largest Eraser presets show smaller than real. */
const MAX_DOT_PX = 40;

type Gesture = {
  startY: number;
  startSize: number;
  timer: number;
  fineTuning: boolean;
  moved: boolean;
};

function SizeDot({
  size,
  paperWidth,
  tool,
  color,
}: {
  size: number;
  paperWidth: number;
  tool: StrokeKind;
  color: string;
}) {
  const px = Math.min(MAX_DOT_PX, Math.max(2, size * paperWidth));
  return (
    <span
      className={cn("rounded-full", tool === "eraser" && "border-foreground/60 border")}
      style={{ width: px, height: px, backgroundColor: tool === "pen" ? color : "var(--paper)" }}
    />
  );
}

/** Tap opens the preset tray. Long-press then vertical drag fine-tunes. The atom is written on release only. */
export function SizeControl({ paperWidth }: { paperWidth: number }) {
  const tool = useAtomValue(toolAtom);
  const [pen, setPen] = useAtom(penAtom);
  const [eraser, setEraser] = useAtom(eraserAtom);
  const [trayOpen, setTrayOpen] = useState(false);
  const [fineSize, setFineSize] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const size = tool === "pen" ? pen.size : eraser.size;
  const setSize = (next: number) =>
    tool === "pen" ? setPen((p) => ({ ...p, size: next })) : setEraser({ size: next });
  const dot = { paperWidth, tool, color: pen.color };

  const endGesture = () => {
    if (gesture.current) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
    setFineSize(null);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClick.current = false;
    const g: Gesture = {
      startY: e.clientY,
      startSize: size,
      fineTuning: false,
      moved: false,
      timer: window.setTimeout(() => {
        g.fineTuning = true;
        setFineSize(g.startSize);
      }, LONG_PRESS_MS),
    };
    gesture.current = g;
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dy = e.clientY - g.startY;
    if (g.fineTuning) setFineSize(sizeFromDrag(g.startSize, dy));
    else if (Math.abs(dy) > TAP_SLOP_PX) {
      window.clearTimeout(g.timer);
      g.moved = true;
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (g.fineTuning) setSize(sizeFromDrag(g.startSize, e.clientY - g.startY));
    suppressClick.current = g.fineTuning || g.moved;
    endGesture();
  };

  return (
    <div className="relative">
      {fineSize !== null && (
        <div className="bg-popover paper-shadow absolute bottom-full left-1/2 mb-2 grid size-16 -translate-x-1/2 place-items-center rounded-full">
          <SizeDot size={fineSize} {...dot} />
        </div>
      )}
      {trayOpen && (
        <div className="bg-background border-border absolute right-0 bottom-full mb-2 flex border">
          {SIZE_PRESETS[tool].map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`ขนาด ${preset}`}
              aria-pressed={preset === size}
              className={cn("grid size-11 place-items-center", preset === size && "bg-muted")}
              onClick={() => {
                setSize(preset);
                setTrayOpen(false);
              }}
            >
              <SizeDot size={preset} {...dot} />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label="ขนาดเส้น"
        aria-expanded={trayOpen}
        className="hover:bg-muted grid size-11 touch-none place-items-center select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endGesture}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (suppressClick.current) suppressClick.current = false;
          else setTrayOpen((open) => !open);
        }}
      >
        <SizeDot size={fineSize ?? size} {...dot} />
      </button>
    </div>
  );
}
