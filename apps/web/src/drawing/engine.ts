import type { Store } from "jotai/vanilla";

import { simplify } from "@/ink/rdp";
import { strokeBBox } from "@/ink/bbox";
import { MAX_STROKE_POINTS } from "@/ink/constants";
import type { InkPoint } from "@/ink/point";
import { uuidv7 } from "@/lib/uuid";
import { penAtom, toolAtom } from "@/state/tool";

import { REF_WIDTH, strokePath } from "./outline";
import type { Stroke } from "./stroke";

export type DrawingEngineOptions = {
  /** Sized by CSS to the Day's aspect ratio. The engine fills it with its two canvases. */
  container: HTMLElement;
  store: Store;
  day: string;
  onCommit: (stroke: Stroke) => void;
};

type Active = {
  pointerId: number;
  pointerType: string;
  color: string;
  size: number;
  hasPressure: boolean;
  points: InkPoint[];
  predicted: InkPoint[];
  rect: DOMRect;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Plain TypeScript, no React. Layers above the container's CSS background: static canvas (committed Strokes), live canvas (the Stroke in progress). */
export class DrawingEngine {
  private readonly container: HTMLElement;
  private readonly store: Store;
  private readonly day: string;
  private readonly onCommit: (stroke: Stroke) => void;
  private readonly staticCanvas = document.createElement("canvas");
  private readonly liveCanvas = document.createElement("canvas");
  private readonly staticCtx: CanvasRenderingContext2D;
  private readonly liveCtx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private strokes: Stroke[] = [];
  private readonly paths = new Map<string, Path2D>();
  private active: Active | null = null;
  private frame = 0;
  private penSeen = false;

  constructor({ container, store, day, onCommit }: DrawingEngineOptions) {
    this.container = container;
    this.store = store;
    this.day = day;
    this.onCommit = onCommit;
    for (const canvas of [this.staticCanvas, this.liveCanvas]) {
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;touch-action:none";
      container.append(canvas);
    }
    this.staticCtx = this.staticCanvas.getContext("2d")!;
    this.liveCtx = this.liveCanvas.getContext("2d", { desynchronized: true })!;
    this.liveCanvas.addEventListener("pointerdown", this.onPointerDown);
    this.liveCanvas.addEventListener("pointermove", this.onPointerMove);
    this.liveCanvas.addEventListener("pointerup", this.onPointerUp);
    this.liveCanvas.addEventListener("pointercancel", this.onPointerCancel);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  setStrokes(strokes: readonly Stroke[]): void {
    this.strokes = [...strokes];
    this.paths.clear();
    this.redraw();
  }

  /** Re-fits both canvases to the container at the current devicePixelRatio and redraws from the cached outlines. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    for (const canvas of [this.staticCanvas, this.liveCanvas]) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    this.redraw();
    if (this.active) {
      this.active.rect = this.liveCanvas.getBoundingClientRect();
      this.scheduleFrame();
    }
  }

  destroy(): void {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.liveCanvas.removeEventListener("pointerdown", this.onPointerDown);
    this.liveCanvas.removeEventListener("pointermove", this.onPointerMove);
    this.liveCanvas.removeEventListener("pointerup", this.onPointerUp);
    this.liveCanvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.staticCanvas.remove();
    this.liveCanvas.remove();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "pen") {
      this.penSeen = true;
      if (this.active && this.active.pointerType !== "pen") this.abort();
    } else if (this.penSeen && this.active?.pointerType === "pen") {
      return;
    }
    if (this.active || e.button > 0) return;
    if (this.store.get(toolAtom) !== "pen") return;
    const { color, size } = this.store.get(penAtom);
    const hasPressure = e.pointerType === "pen";
    this.liveCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.active = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      color,
      size,
      hasPressure,
      points: [],
      predicted: [],
      rect: this.liveCanvas.getBoundingClientRect(),
    };
    this.record(e);
    this.scheduleFrame();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    const coalesced = e.getCoalescedEvents?.();
    if (coalesced?.length) for (const c of coalesced) this.record(c);
    else this.record(e);
    a.predicted = (e.getPredictedEvents?.() ?? []).map((p) => this.toPoint(a, p));
    this.scheduleFrame();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.commit(a);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.active?.pointerId === e.pointerId) this.abort();
  };

  private record(e: PointerEvent): void {
    const a = this.active!;
    a.points.push(this.toPoint(a, e));
  }

  private toPoint(a: Active, e: PointerEvent): InkPoint {
    const x = clamp01((e.clientX - a.rect.left) / a.rect.width);
    const y = clamp01((e.clientY - a.rect.top) / a.rect.height);
    return a.hasPressure ? { x, y, pressure: e.pressure } : { x, y };
  }

  private scheduleFrame(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.drawLive);
  }

  private drawLive = (): void => {
    this.frame = 0;
    const a = this.active;
    this.clear(this.liveCtx);
    if (!a) return;
    const path = strokePath([...a.points, ...a.predicted], a.size, a.hasPressure, false);
    this.fill(this.liveCtx, path, a.color);
  };

  private commit(a: Active): void {
    this.active = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.clear(this.liveCtx);
    const points = fitToLimit(a.points);
    const stroke: Stroke = {
      id: uuidv7(),
      day: this.day,
      kind: "pen",
      color: a.color,
      size: a.size,
      points,
      hasPressure: a.hasPressure,
      bbox: strokeBBox(points, a.size, "pen"),
      createdAt: Date.now(),
    };
    this.strokes.push(stroke);
    this.fill(this.staticCtx, this.outline(stroke), a.color);
    this.onCommit(stroke);
  }

  private abort(): void {
    this.active = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.clear(this.liveCtx);
  }

  private outline(stroke: Stroke): Path2D {
    let path = this.paths.get(stroke.id);
    if (!path) {
      path = strokePath(stroke.points, stroke.size, stroke.hasPressure, true);
      this.paths.set(stroke.id, path);
    }
    return path;
  }

  private redraw(): void {
    this.clear(this.staticCtx);
    for (const s of this.strokes) {
      if (s.kind === "pen") this.fill(this.staticCtx, this.outline(s), s.color!);
    }
  }

  private clear(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  private fill(ctx: CanvasRenderingContext2D, path: Path2D, color: string): void {
    const scale = ctx.canvas.width / REF_WIDTH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = color;
    ctx.fill(path);
  }
}

/** Simplifies with RDP, widening epsilon until the Stroke fits the codec's point limit. */
function fitToLimit(points: InkPoint[]): InkPoint[] {
  let out = simplify(points);
  for (let eps = 0.001; out.length > MAX_STROKE_POINTS; eps *= 2) out = simplify(points, eps);
  return out;
}
