import { computeBackoff, sleep, type BackoffOptions } from "./backoff.js";
import { NonRetryableError } from "./errors.js";
import { silentLogger } from "./logger.js";
import { MemoryIdempotencyStore } from "./stores/memory-store.js";
import type {
  DeadLetterSink,
  IdempotencyStore,
  Logger,
  ProcessResult,
  WebhookEvent,
  WebhookHandler,
} from "./types.js";

export interface WebhookEngineOptions {
  /** Idempotency persistence. Defaults to an in-memory store. */
  store?: IdempotencyStore;
  /** Max delivery attempts (initial try + retries). Default: 5. */
  maxAttempts?: number;
  /** Backoff configuration for retries. */
  backoff?: BackoffOptions;
  /** Invoked when an event exhausts retries or fails permanently. */
  deadLetter?: DeadLetterSink;
  /** Structured logger. Defaults to a no-op. */
  logger?: Logger;
  /** Injectable sleep (testability). */
  sleepFn?: (ms: number) => Promise<void>;
  /** Injectable randomness for jitter (testability). */
  rng?: () => number;
}

/**
 * Idempotent, retrying webhook dispatcher.
 *
 * Guarantees:
 * - An event id is processed to completion at most once (idempotency store).
 * - Transient handler failures are retried with capped exponential backoff.
 * - Permanently failed events are routed to the dead-letter sink.
 */
export class WebhookEngine {
  private readonly handlers = new Map<string, WebhookHandler>();
  private fallback?: WebhookHandler;

  private readonly store: IdempotencyStore;
  private readonly maxAttempts: number;
  private readonly backoff: BackoffOptions;
  private readonly deadLetter?: DeadLetterSink;
  private readonly logger: Logger;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly rng: () => number;

  constructor(options: WebhookEngineOptions = {}) {
    this.store = options.store ?? new MemoryIdempotencyStore();
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.backoff = options.backoff ?? {};
    this.deadLetter = options.deadLetter;
    this.logger = options.logger ?? silentLogger;
    this.sleepFn = options.sleepFn ?? sleep;
    this.rng = options.rng ?? Math.random;
  }

  /** Register a handler for a specific event type. Returns `this` for chaining. */
  on<T = unknown>(type: string, handler: WebhookHandler<T>): this {
    this.handlers.set(type, handler as WebhookHandler);
    return this;
  }

  /** Handler used when no specific type matches. */
  onAny<T = unknown>(handler: WebhookHandler<T>): this {
    this.fallback = handler as WebhookHandler;
    return this;
  }

  /**
   * Process an event end-to-end: idempotency gate, retries and dead-lettering.
   */
  async process<T = unknown>(
    event: WebhookEvent<T>,
  ): Promise<ProcessResult> {
    const outcome = await this.store.begin(event.id);

    if (outcome.kind === "completed") {
      this.logger.debug("duplicate event ignored", { id: event.id });
      return { status: "duplicate", attempts: outcome.record.attempts };
    }
    if (outcome.kind === "in_progress") {
      this.logger.debug("event already in progress", { id: event.id });
      return { status: "in_progress", attempts: outcome.record.attempts };
    }

    const handler = this.handlers.get(event.type) ?? this.fallback;
    if (!handler) {
      // No handler: acknowledge so the provider stops retrying, but record it.
      await this.store.complete(event.id);
      this.logger.warn("no handler for event type", {
        id: event.id,
        type: event.type,
      });
      return { status: "ignored", attempts: 0 };
    }

    return this.runWithRetries(event, handler as WebhookHandler<T>);
  }

  private async runWithRetries<T>(
    event: WebhookEvent<T>,
    handler: WebhookHandler<T>,
  ): Promise<ProcessResult> {
    let lastError = "";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await handler(event);
        await this.store.complete(event.id);
        this.logger.info("event processed", {
          id: event.id,
          type: event.type,
          attempt,
        });
        return { status: "processed", attempts: attempt };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const permanent = err instanceof NonRetryableError;
        const exhausted = attempt >= this.maxAttempts;

        this.logger.warn("handler attempt failed", {
          id: event.id,
          type: event.type,
          attempt,
          permanent,
          error: lastError,
        });

        if (permanent || exhausted) break;

        const delay = computeBackoff(attempt, this.backoff, this.rng);
        await this.sleepFn(delay);
      }
    }

    await this.store.fail(event.id, lastError);
    await this.sendToDeadLetter(event, lastError);
    return {
      status: "dead_lettered",
      attempts: this.maxAttempts,
      error: lastError,
    };
  }

  private async sendToDeadLetter<T>(
    event: WebhookEvent<T>,
    error: string,
  ): Promise<void> {
    if (!this.deadLetter) {
      this.logger.error("event failed with no dead-letter sink", {
        id: event.id,
        error,
      });
      return;
    }
    try {
      await this.deadLetter({
        event: event as WebhookEvent,
        attempts: this.maxAttempts,
        error,
        failedAt: Date.now(),
      });
      this.logger.error("event dead-lettered", { id: event.id, error });
    } catch (sinkErr) {
      this.logger.error("dead-letter sink threw", {
        id: event.id,
        error: sinkErr instanceof Error ? sinkErr.message : String(sinkErr),
      });
    }
  }
}
