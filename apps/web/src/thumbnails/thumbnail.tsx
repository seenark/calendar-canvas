import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { dayStore, type DaySnapshot } from "@/sync/day-store";

import { thumbnails } from "./client";

/** Cells within this distance of the viewport render ahead of the scroll. */
const VISIBLE_MARGIN = "100px 0px";

/** Notifies when `devicePixelRatio` changes. A `resolution` query only fires for the ratio it was made with, so it is remade each time. */
function subscribeDpr(notify: () => void): () => void {
  let query: MediaQueryList;
  const onChange = () => {
    notify();
    watch();
  };
  const watch = () => {
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", onChange, { once: true });
  };
  watch();
  return () => query.removeEventListener("change", onChange);
}

/** A Day with no Strokes has nothing to show, so it renders no canvas. Subscribes to its own Day only. */
export function Thumbnail({ day }: { day: string }) {
  const { revision, strokes } = useSyncExternalStore(dayStore.subscribe, () =>
    dayStore.getSnapshot(day),
  );
  if (strokes.length === 0) return null;
  return <ThumbnailCanvas day={day} revision={revision} strokes={strokes} />;
}

/**
 * Paper-sized stand-in for a Day's thumbnail that needs no worker render: copies the bitmap its Day cell
 * already shows and lets CSS stretch it. Draws nothing when the cell has no rendered thumbnail.
 */
export function CellThumbnailCopy({ day }: { day: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const source = document.querySelector<HTMLCanvasElement>(
      `[data-day-cell="${day}"] [data-slot="thumbnail"]`,
    );
    if (!source || source.width === 0 || source.height === 0) return;
    const canvas = ref.current!;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")!.drawImage(source, 0, 0);
  }, [day]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" />;
}

function ThumbnailCanvas({
  day,
  revision,
  strokes,
}: { day: string } & Pick<DaySnapshot, "revision" | "strokes">) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const dpr = useSyncExternalStore(subscribeDpr, () => window.devicePixelRatio || 1);

  useEffect(() => {
    const canvas = ref.current!;
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize((prev) =>
        prev?.width === width && prev.height === height ? prev : { width, height },
      );
    });
    const intersection = new IntersectionObserver(
      (entries) => setVisible(entries.at(-1)!.isIntersecting),
      { rootMargin: VISIBLE_MARGIN },
    );
    resize.observe(canvas);
    intersection.observe(canvas);
    return () => {
      resize.disconnect();
      intersection.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || !size || size.width === 0 || size.height === 0) return;
    const ctx = ref.current!.getContext("bitmaprenderer")!;
    const abort = new AbortController();
    thumbnails.render({ day, revision, strokes, dpr, ...size }, abort.signal).then((bitmap) => {
      if (!bitmap) return;
      const canvas = ref.current!;
      // transferFromImageBitmap leaves width/height at 300x150, which CellThumbnailCopy reads as the bitmap size.
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.transferFromImageBitmap(bitmap);
    });
    return () => abort.abort();
  }, [day, revision, strokes, size, visible, dpr]);

  return (
    <canvas
      ref={ref}
      data-slot="thumbnail"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}
