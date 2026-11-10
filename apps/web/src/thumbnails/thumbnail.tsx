import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
    thumbnails
      .render({ day, revision, strokes, dpr, ...size }, abort.signal)
      .then((bitmap) => bitmap && ctx.transferFromImageBitmap(bitmap));
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
