/** Cache key of a Day cell thumbnail. A revision change or a different pixel size is a different picture. */
export function thumbnailKey(day: string, revision: number, width: number, height: number): string {
  return `${day}:${revision}@${width}x${height}`;
}

/** Least recently used entries leave first. `onEvict` runs for every entry that leaves, replaced or evicted. */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(
    private readonly capacity: number,
    private readonly onEvict: (value: V) => void = () => {},
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    const old = this.entries.get(key);
    if (old !== undefined) {
      this.entries.delete(key);
      if (old !== value) this.onEvict(old);
    }
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const [oldest, evicted] = this.entries.entries().next().value!;
      this.entries.delete(oldest);
      this.onEvict(evicted);
    }
  }
}
