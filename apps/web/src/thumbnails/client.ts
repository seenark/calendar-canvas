import type { Stroke } from "@/drawing/stroke";

import { LruCache, thumbnailKey } from "./cache";
import type { ThumbnailRequest, ThumbnailResponse } from "./protocol";

const CACHE_ENTRIES = 200;

export type ThumbnailSpec = {
  day: string;
  /** The Day's `DayStore` revision. A new revision is a cache miss. */
  revision: number;
  strokes: readonly Stroke[];
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
};

type Waiter = { signal: AbortSignal; resolve: (bitmap: ImageBitmap | null) => void };
type Job = { request: ThumbnailRequest; waiters: Set<Waiter> };

/**
 * Main-thread side of the thumbnail worker: an LRU of rendered bitmaps and a queue of one job per Day.
 * A newer request for a Day replaces its queued one, and a job nobody waits for any more leaves the queue.
 */
export class ThumbnailClient {
  private worker: Worker | undefined;
  private readonly cache = new LruCache<ImageBitmap>(CACHE_ENTRIES, (bitmap) => bitmap.close());
  private readonly queue = new Map<string, Job>();
  private inFlight: Job | null = null;

  /**
   * Resolves with a bitmap the caller owns, or null when the signal aborts, a newer request replaces this one,
   * or rendering fails. The cache keeps its own copy, so `transferFromImageBitmap` can consume the result.
   */
  render(spec: ThumbnailSpec, signal: AbortSignal): Promise<ImageBitmap | null> {
    const { day, revision, strokes, width, height, dpr } = spec;
    const key = thumbnailKey(day, revision, Math.round(width * dpr), Math.round(height * dpr));
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(null);
      const waiter: Waiter = { signal, resolve };
      const cached = this.cache.get(key);
      if (cached) return this.deliver(cached, waiter);

      let job: Job | undefined = this.inFlight?.request.key === key ? this.inFlight : undefined;
      const queued = this.queue.get(day);
      if (!job && queued?.request.key === key) job = queued;
      if (!job) {
        if (queued) for (const w of queued.waiters) w.resolve(null);
        job = { request: { key, day, strokes, width, height, dpr }, waiters: new Set() };
        this.queue.set(day, job);
      }
      job.waiters.add(waiter);
      const owner = job;
      signal.addEventListener(
        "abort",
        () => {
          owner.waiters.delete(waiter);
          resolve(null);
          if (owner.waiters.size === 0 && this.queue.get(day) === owner) this.queue.delete(day);
        },
        { once: true },
      );
      this.pump();
    });
  }

  private deliver(bitmap: ImageBitmap, { signal, resolve }: Waiter): void {
    createImageBitmap(bitmap).then(
      (copy) => {
        if (!signal.aborted) return resolve(copy);
        copy.close();
        resolve(null);
      },
      () => resolve(null),
    );
  }

  private pump(): void {
    if (this.inFlight) return;
    const next = this.queue.entries().next().value;
    if (!next) return;
    const [day, job] = next;
    this.queue.delete(day);
    this.inFlight = job;
    this.worker ??= this.spawn();
    this.worker.postMessage(job.request);
  }

  private spawn(): Worker {
    const worker = new Worker(new URL("./thumbnail.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }: MessageEvent<ThumbnailResponse>) => this.settle(data);
    worker.onerror = () => {
      worker.terminate();
      this.worker = undefined;
      this.settle(null);
    };
    return worker;
  }

  private settle(response: ThumbnailResponse | null): void {
    const job = this.inFlight;
    this.inFlight = null;
    if (job) {
      if (response && "bitmap" in response) {
        this.cache.set(response.key, response.bitmap);
        for (const waiter of job.waiters) this.deliver(response.bitmap, waiter);
      } else {
        for (const waiter of job.waiters) waiter.resolve(null);
      }
    }
    this.pump();
  }
}

export const thumbnails = new ThumbnailClient();
