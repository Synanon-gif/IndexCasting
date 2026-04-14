/**
 * Simple LRU (Least Recently Used) Map with a configurable max-entry limit.
 *
 * Used to bound in-memory caches (e.g. per-thread message arrays) so they
 * don't grow indefinitely in long-running sessions with thousands of threads.
 *
 * Entries are evicted oldest-access-first when the map exceeds `maxSize`.
 */
export class LRUMap<K, V> {
  private readonly maxSize: number;
  private readonly map = new Map<K, V>();

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error('LRUMap maxSize must be >= 1');
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.evict();
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Iterate entries in insertion order (oldest first). */
  *entries(): IterableIterator<[K, V]> {
    yield* this.map.entries();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  private evict(): void {
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      } else {
        break;
      }
    }
  }
}
