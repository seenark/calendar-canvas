import { cn } from "@calendar-canvas/ui/lib/utils";
import { useAtom, useAtomValue } from "jotai/react";
import { useEffect, useRef, useState, type PointerEvent, type Ref } from "react";

import { SIZE_PRESETS, sizeFromDrag } from "@/drawing/sizes";
import type { StrokeKind } from "@/drawing/stroke";
import { eraserAtom, penAtom, toolAtom } from "@/state/tool";

const LONG_PRESS_MS = 350;
const TAP_SLOP_PX = 10;

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
  className,
  ref,
}: {
  size: number;
  paperWidth: number;
  tool: StrokeKind;
  color: string;
  className?: string;
  ref?: Ref<HTMLSpanElement>;
}) {
  const px = size * paperWidth;
  return (
    <span
      ref={ref}
      className={cn(
        "pointer-events-none rounded-full",
        tool === "eraser" && "border-foreground/60 border",
        className,
      )}
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
  const [fineTuning, setFineTuning] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const buttonDot = useRef<HTMLSpanElement>(null);
  const popoverDot = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const size = tool === "pen" ? pen.size : eraser.size;
  const setSize = (next: number) =>
    tool === "pen" ? setPen((p) => ({ ...p, size: next })) : setEraser({ size: next });
  const dot = { paperWidth, tool, color: pen.color };

  useEffect(() => {
    if (!trayOpen) return;
    const close = (e: globalThis.PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setTrayOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [trayOpen]);

  /** Pointer moves repaint the dots directly. State changes only when the long-press starts and ends. */
  const paint = (s: number) => {
    for (const el of [buttonDot.current, popoverDot.current]) {
      if (el) el.style.width = el.style.height = `${s * paperWidth}px`;
    }
  };

  const endGesture = (finalSize: number) => {
    if (gesture.current) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
    setFineTuning(false);
    paint(finalSize);
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
        setFineTuning(true);
      }, LONG_PRESS_MS),
    };
    gesture.current = g;
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dy = e.clientY - g.startY;
    if (g.fineTuning) paint(sizeFromDrag(g.startSize, dy));
    else if (Math.abs(dy) > TAP_SLOP_PX) {
      window.clearTimeout(g.timer);
      g.moved = true;
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    let next = size;
    if (g.fineTuning) {
      next = sizeFromDrag(g.startSize, e.clientY - g.startY);
      setSize(next);
    }
    suppressClick.current = g.fineTuning || g.moved;
    endGesture(next);
  };

  return (
    <div ref={root} className="relative">
      {fineTuning && (
        <div className="bg-popover paper-shadow absolute bottom-full left-1/2 mb-2 grid min-h-16 min-w-16 -translate-x-1/2 place-items-center rounded-full">
          <SizeDot ref={popoverDot} size={size} {...dot} />
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
              className={cn(
                "grid min-h-11 min-w-11 place-items-center",
                preset === size && "bg-muted",
              )}
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
        className="hover:bg-muted relative size-11 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => endGesture(size)}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (suppressClick.current) suppressClick.current = false;
          else setTrayOpen((open) => !open);
        }}
      >
        <SizeDot
          ref={buttonDot}
          size={size}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          {...dot}
        />
      </button>
    </div>
  );
}
