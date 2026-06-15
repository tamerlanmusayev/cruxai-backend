/**
 * Minimal in-memory TTL cache. `wrap` returns a cached value if fresh,
 * otherwise computes, stores, and returns it. Used to collapse repeated
 * load (polled /stats, /reviews, external book search) into one call per TTL.
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expires: number }>();

  constructor(private readonly ttlMs: number) {}

  async wrap(key: string, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expires > now) return hit.value;
    const value = await compute();
    this.store.set(key, { value, expires: now + this.ttlMs });
    // opportunistic cleanup so the map doesn't grow unbounded
    if (this.store.size > 200) {
      for (const [k, v] of this.store) if (v.expires <= now) this.store.delete(k);
    }
    return value;
  }
}
