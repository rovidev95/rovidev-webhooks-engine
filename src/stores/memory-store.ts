import type {
  BeginOutcome,
  IdempotencyStore,
  ProcessRecord,
} from "../types.js";

export interface MemoryStoreOptions {
  /** Time-to-live for completed records, in ms. Default: 24h. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * In-memory idempotency store. Great for tests and single-process apps.
 * For multi-instance deployments use the Redis store instead.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, ProcessRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  async begin(id: string): Promise<BeginOutcome> {
    this.evictExpired();
    const existing = this.records.get(id);
    const ts = this.now();

    if (existing) {
      if (existing.state === "completed") {
        return { kind: "completed", record: existing };
      }
      if (existing.state === "processing") {
        return { kind: "in_progress", record: existing };
      }
      // failed -> re-acquire for retry
      const record: ProcessRecord = {
        ...existing,
        state: "processing",
        attempts: existing.attempts,
        updatedAt: ts,
      };
      this.records.set(id, record);
      return { kind: "failed", record };
    }

    const record: ProcessRecord = {
      state: "processing",
      attempts: 0,
      firstSeenAt: ts,
      updatedAt: ts,
    };
    this.records.set(id, record);
    return { kind: "new", record };
  }

  async complete(id: string): Promise<void> {
    const ts = this.now();
    const existing = this.records.get(id);
    this.records.set(id, {
      state: "completed",
      attempts: (existing?.attempts ?? 0) + 1,
      firstSeenAt: existing?.firstSeenAt ?? ts,
      updatedAt: ts,
    });
  }

  async fail(id: string, error: string): Promise<void> {
    const ts = this.now();
    const existing = this.records.get(id);
    this.records.set(id, {
      state: "failed",
      attempts: (existing?.attempts ?? 0) + 1,
      firstSeenAt: existing?.firstSeenAt ?? ts,
      updatedAt: ts,
      error,
    });
  }

  async forget(id: string): Promise<void> {
    this.records.delete(id);
  }

  /** Test/observability helper. */
  snapshot(id: string): ProcessRecord | undefined {
    return this.records.get(id);
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, record] of this.records) {
      if (record.state === "completed" && record.updatedAt < cutoff) {
        this.records.delete(id);
      }
    }
  }
}
