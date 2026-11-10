import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { dayStore, type DaySnapshot } from "@/sync/day-store";

import { thumbnails } from "./client";

/** A Day with no Strokes has nothing to show, so it renders no canvas. Subscribes to its own Day only. */
export function Thumbnail({ day }: { day: string }) {
  const { revision, strokes } = useSyncExternalStore(dayStore.subscribe, () =>
    dayStore.getSnapshot(day),
  );
  if (strokes.length === 0) return null;
  return <ThumbnailCanvas day={day} revision={revision} strokes={strokes} />;
}

function ThumbnailCanvas({
  day,
  revision,
  strokes,
}: { day: string } & Pick<DaySnapshot, "revision" | "strokes">) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize((prev) =>
        prev?.width === width && prev.height === height ? prev : { width, height },
      );
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!size || size.width === 0 || size.height === 0) return;
    const ctx = ref.current!.getContext("bitmaprenderer")!;
    const abort = new AbortController();
    const dpr = window.devicePixelRatio || 1;
    thumbnails
      .render({ day, revision, strokes, dpr, ...size }, abort.signal)
      .then((bitmap) => bitmap && ctx.transferFromImageBitmap(bitmap));
    return () => abort.abort();
  }, [day, revision, strokes, size]);

  return (
    <canvas
      ref={ref}
      data-slot="thumbnail"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}
