import type {
  BeginOutcome,
  IdempotencyStore,
  ProcessRecord,
  ProcessState,
} from "../types.js";

/**
 * Minimal structural type for the Redis client we depend on. This keeps
 * `ioredis` an optional peer dependency: callers pass their own client.
 */
export interface RedisLike {
  set(
    key: string,
    value: string,
    mode: "PX",
    ttl: number,
    flag: "NX",
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface RedisStoreOptions {
  /** Key prefix in Redis. Default: "wh:idem:". */
  keyPrefix?: string;
  /** TTL for records, in ms. Default: 24h. */
  ttlMs?: number;
  now?: () => number;
}

interface StoredRecord {
  s: ProcessState;
  a: number;
  f: number;
  u: number;
  e?: string;
}

/**
 * Redis-backed idempotency store safe across multiple processes/instances.
 * Atomicity for the initial lock relies on `SET key value PX ttl NX`.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly redis: RedisLike;
  private readonly prefix: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(redis: RedisLike, options: RedisStoreOptions = {}) {
    this.redis = redis;
    this.prefix = options.keyPrefix ?? "wh:idem:";
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  private toRecord(stored: StoredRecord): ProcessRecord {
    return {
      state: stored.s,
      attempts: stored.a,
      firstSeenAt: stored.f,
      updatedAt: stored.u,
      error: stored.e,
    };
  }

  private serialize(record: ProcessRecord): string {
    const stored: StoredRecord = {
      s: record.state,
      a: record.attempts,
      f: record.firstSeenAt,
      u: record.updatedAt,
      e: record.error,
    };
    return JSON.stringify(stored);
  }

  async begin(id: string): Promise<BeginOutcome> {
    const key = this.key(id);
    const ts = this.now();
    const fresh: ProcessRecord = {
      state: "processing",
      attempts: 0,
      firstSeenAt: ts,
      updatedAt: ts,
    };

    const acquired = await this.redis.set(
      key,
      this.serialize(fresh),
      "PX",
      this.ttlMs,
      "NX",
    );

    if (acquired) {
      return { kind: "new", record: fresh };
    }

    const raw = await this.redis.get(key);
    if (!raw) {
      // Key vanished between SET NX and GET (TTL race). Retry as new.
      return this.begin(id);
    }

    const record = this.toRecord(JSON.parse(raw) as StoredRecord);
    if (record.state === "completed") {
      return { kind: "completed", record };
    }
    if (record.state === "processing") {
      return { kind: "in_progress", record };
    }

    // failed -> re-acquire by overwriting with processing state.
    const retrying: ProcessRecord = {
      ...record,
      state: "processing",
      updatedAt: ts,
    };
    await this.redis.set(key, this.serialize(retrying), "PX", this.ttlMs);
    return { kind: "failed", record: retrying };
  }

  async complete(id: string): Promise<void> {
    await this.transition(id, "completed");
  }

  async fail(id: string, error: string): Promise<void> {
    await this.transition(id, "failed", error);
  }

  async forget(id: string): Promise<void> {
    await this.redis.del(this.key(id));
  }

  private async transition(
    id: string,
    state: ProcessState,
    error?: string,
  ): Promise<void> {
    const key = this.key(id);
    const ts = this.now();
    const raw = await this.redis.get(key);
    const prev = raw ? (JSON.parse(raw) as StoredRecord) : undefined;
    const record: ProcessRecord = {
      state,
      attempts: (prev?.a ?? 0) + 1,
      firstSeenAt: prev?.f ?? ts,
      updatedAt: ts,
      error,
    };
    await this.redis.set(key, this.serialize(record), "PX", this.ttlMs);
  }
}
