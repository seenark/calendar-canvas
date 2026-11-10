import type { Store } from "jotai/vanilla";

import { strokeBBox } from "@/ink/bbox";
import { fitToLimit } from "@/ink/rdp";
import type { InkPoint } from "@/ink/point";
import { uuidv7 } from "@/lib/uuid";
import { eraserAtom, penAtom, toolAtom } from "@/state/tool";

import { REF_HEIGHT, REF_WIDTH, strokePath } from "./outline";
import type { Stroke, StrokeKind } from "./stroke";

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
  kind: StrokeKind;
  color: string | null;
  size: number;
  hasPressure: boolean;
  points: InkPoint[];
  predicted: InkPoint[];
  rect: DOMRect;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const RING_COLOR = "#4c4f69";

/** Plain TypeScript, no React. Layers above the container's CSS background: static canvas (committed Strokes), live canvas (the Stroke in progress). */
export class DrawingEngine {
  private readonly container: HTMLElement;
  private readonly store: Store;
  private readonly day: string;
  private readonly onCommit: (stroke: Stroke) => void;
  private readonly staticCanvas = document.createElement("canvas");
  private readonly liveCanvas = document.createElement("canvas");
  /** The static canvas as it was before the active Eraser began. Every Eraser frame is this plus one full outline. */
  private readonly snapshot = document.createElement("canvas");
  private snapshotValid = false;
  private readonly staticCtx: CanvasRenderingContext2D;
  private readonly liveCtx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private strokes: Stroke[] = [];
  private readonly paths = new Map<string, Path2D>();
  private active: Active | null = null;
  private ending: { a: Active; commit: boolean }[] = [];
  private staticDirty = false;
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
    this.staticDirty = true;
    this.scheduleFrame();
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
    for (const { a, commit } of this.ending) if (commit) this.finalize(a);
    this.ending = [];
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
      if (this.active && this.active.pointerType !== "pen") this.finish(false);
    } else if (this.penSeen && this.active?.pointerType === "pen") {
      return;
    }
    if (this.active || e.button > 0) return;
    const kind = this.store.get(toolAtom);
    const { color, size } =
      kind === "pen"
        ? this.store.get(penAtom)
        : { color: null, size: this.store.get(eraserAtom).size };
    const hasPressure = kind === "pen" && e.pointerType === "pen";
    this.liveCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.active = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      kind,
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
    this.recordCoalesced(a, e);
    a.predicted = (e.getPredictedEvents?.() ?? []).map((p) => this.toPoint(a, p));
    this.scheduleFrame();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.recordCoalesced(a, e);
    this.finish(true);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.active?.pointerId === e.pointerId) this.finish(false);
  };

  private finish(commit: boolean): void {
    this.ending.push({ a: this.active!, commit });
    this.active = null;
    this.scheduleFrame();
  }

  private record(e: PointerEvent): void {
    const a = this.active!;
    a.points.push(this.toPoint(a, e));
  }

  private recordCoalesced(a: Active, e: PointerEvent): void {
    const coalesced = e.getCoalescedEvents?.();
    if (coalesced?.length) for (const c of coalesced) a.points.push(this.toPoint(a, c));
    else a.points.push(this.toPoint(a, e));
  }

  private toPoint(a: Active, e: PointerEvent): InkPoint {
    const x = clamp01((e.clientX - a.rect.left) / a.rect.width);
    const y = clamp01((e.clientY - a.rect.top) / a.rect.height);
    return a.hasPressure ? { x, y, pressure: e.pressure } : { x, y };
  }

  private scheduleFrame(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.drawFrame);
  }

  private drawFrame = (): void => {
    this.frame = 0;
    for (const { a, commit } of this.ending) {
      if (commit) this.commit(a);
      else if (a.kind === "eraser") this.staticDirty = true;
    }
    this.ending = [];
    if (this.staticDirty) {
      this.staticDirty = false;
      this.redraw();
    }
    const a = this.active;
    this.clear(this.liveCtx);
    if (!a) return;
    if (a.kind === "eraser") {
      this.eraseOverSnapshot(strokePath(a.points, a.size, "eraser", false, false));
      this.drawRing(a);
      return;
    }
    const path = strokePath([...a.points, ...a.predicted], a.size, "pen", a.hasPressure, false);
    this.fill(this.liveCtx, path, a.color);
  };

  private finalize(a: Active): Stroke {
    const points = fitToLimit(a.points, a.hasPressure);
    const stroke: Stroke = {
      id: uuidv7(),
      day: this.day,
      kind: a.kind,
      color: a.color,
      size: a.size,
      points,
      hasPressure: a.hasPressure,
      bbox: strokeBBox(points, a.size, a.kind),
      createdAt: Date.now(),
    };
    this.strokes.push(stroke);
    this.onCommit(stroke);
    return stroke;
  }

  private commit(a: Active): void {
    const stroke = this.finalize(a);
    if (this.staticDirty) return;
    if (stroke.kind === "eraser") {
      this.eraseOverSnapshot(this.outline(stroke));
      this.snapshotValid = false;
    } else this.fill(this.staticCtx, this.outline(stroke), stroke.color);
  }

  private outline(stroke: Stroke): Path2D {
    let path = this.paths.get(stroke.id);
    if (!path) {
      path = strokePath(stroke.points, stroke.size, stroke.kind, stroke.hasPressure, true);
      this.paths.set(stroke.id, path);
    }
    return path;
  }

  private redraw(): void {
    this.snapshotValid = false;
    this.clear(this.staticCtx);
    for (const s of this.strokes) this.fill(this.staticCtx, this.outline(s), s.color);
  }

  /**
   * Restores the pre-Eraser pixels and erases one whole outline from them, so the static canvas is always
   * "earlier Strokes, then this outline", the same composition `redraw` produces for a committed Eraser.
   */
  private eraseOverSnapshot(outline: Path2D): void {
    if (!this.snapshotValid) this.takeSnapshot();
    const ctx = this.staticCtx;
    this.clear(ctx);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.snapshot, 0, 0);
    this.fill(ctx, outline, null);
  }

  private takeSnapshot(): void {
    const { width, height } = this.staticCanvas;
    if (this.snapshot.width !== width || this.snapshot.height !== height) {
      this.snapshot.width = width;
      this.snapshot.height = height;
    }
    const ctx = this.snapshot.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.staticCanvas, 0, 0);
    this.snapshotValid = true;
  }

  private drawRing(a: Active): void {
    const p = a.predicted.at(-1) ?? a.points.at(-1);
    if (!p) return;
    const ctx = this.liveCtx;
    const scale = ctx.canvas.width / REF_WIDTH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.beginPath();
    ctx.arc(p.x * REF_WIDTH, p.y * REF_HEIGHT, (a.size * REF_WIDTH) / 2, 0, 2 * Math.PI);
    ctx.lineWidth = (window.devicePixelRatio || 1) / scale;
    ctx.strokeStyle = RING_COLOR;
    ctx.stroke();
  }

  private clear(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  /** A null colour is the Eraser: it removes what is already on the canvas. */
  private fill(ctx: CanvasRenderingContext2D, path: Path2D, color: string | null): void {
    const scale = ctx.canvas.width / REF_WIDTH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = color === null ? "destination-out" : "source-over";
    if (color !== null) ctx.fillStyle = color;
    ctx.fill(path);
  }
}
