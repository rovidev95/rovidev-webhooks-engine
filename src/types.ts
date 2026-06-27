/**
 * Core domain types for the webhook engine.
 */

export interface WebhookEvent<T = unknown> {
  /** Provider-unique identifier. Used as the idempotency key. */
  id: string;
  /** Logical event type, e.g. "payment.succeeded". */
  type: string;
  /** Decoded payload. */
  payload: T;
  /** Epoch millis when the event was received by this service. */
  receivedAt: number;
}

export type WebhookHandler<T = unknown> = (
  event: WebhookEvent<T>,
) => void | Promise<void>;

export type ProcessState = "processing" | "completed" | "failed";

export interface ProcessRecord {
  state: ProcessState;
  attempts: number;
  firstSeenAt: number;
  updatedAt: number;
  error?: string;
}

export type BeginOutcome =
  | { kind: "new"; record: ProcessRecord }
  | { kind: "in_progress"; record: ProcessRecord }
  | { kind: "completed"; record: ProcessRecord }
  | { kind: "failed"; record: ProcessRecord };

/**
 * Pluggable persistence for idempotency bookkeeping. Implementations MUST make
 * {@link IdempotencyStore.begin} atomic to be safe under concurrency.
 */
export interface IdempotencyStore {
  /**
   * Atomically register an event for processing.
   * - "new": first time we see this id (lock acquired).
   * - "in_progress": another worker is currently processing it.
   * - "completed": already handled, caller should treat as duplicate.
   * - "failed": previously failed; caller may retry (lock acquired).
   */
  begin(id: string): Promise<BeginOutcome>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  /** Remove bookkeeping for an id (mostly for tests / manual replays). */
  forget(id: string): Promise<void>;
}

export type ProcessStatus =
  | "processed"
  | "duplicate"
  | "in_progress"
  | "ignored"
  | "dead_lettered";

export interface ProcessResult {
  status: ProcessStatus;
  attempts: number;
  error?: string;
}

export interface DeadLetter<T = unknown> {
  event: WebhookEvent<T>;
  attempts: number;
  error: string;
  failedAt: number;
}

export type DeadLetterSink = (entry: DeadLetter) => void | Promise<void>;

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
