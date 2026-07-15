/** TTL cache holding a single value, with single-flight fetch deduplication. */
export class TtlCache<T> {
  private value: T | null = null;
  private expiresAt = 0;
  private inflight: Promise<T> | null = null;

  constructor(
    private ttlMs: number,
    private fetcher: () => Promise<T>,
  ) {}

  async get(): Promise<T> {
    if (this.value !== null && Date.now() < this.expiresAt) return this.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetcher()
      .then((value) => {
        this.value = value;
        this.expiresAt = Date.now() + this.ttlMs;
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  invalidate(): void {
    this.value = null;
    this.expiresAt = 0;
  }
}

/** TTL map with per-key single-flight, separate TTLs for hits and misses. */
export class TtlMap<V> {
  private entries = new Map<string, { value: V; expiresAt: number }>();
  private inflight = new Map<string, Promise<V>>();

  constructor(
    private positiveTtlMs: number,
    private negativeTtlMs: number,
    private isNegative: (value: V) => boolean,
  ) {}

  async get(key: string, fetcher: () => Promise<V>): Promise<V> {
    const entry = this.entries.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = fetcher()
      .then((value) => {
        const ttl = this.isNegative(value) ? this.negativeTtlMs : this.positiveTtlMs;
        this.entries.set(key, { value, expiresAt: Date.now() + ttl });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }
}
