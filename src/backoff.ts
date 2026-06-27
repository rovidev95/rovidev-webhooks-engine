export interface BackoffOptions {
  /** Delay for the first retry, in ms. Default: 200. */
  baseMs?: number;
  /** Upper bound for any single delay, in ms. Default: 30_000. */
  maxMs?: number;
  /** Growth factor per attempt. Default: 2. */
  factor?: number;
  /** Apply full jitter to avoid thundering herds. Default: true. */
  jitter?: boolean;
}

const DEFAULTS: Required<BackoffOptions> = {
  baseMs: 200,
  maxMs: 30_000,
  factor: 2,
  jitter: true,
};

/**
 * Compute the delay before retry number `attempt` (1-indexed).
 * Uses capped exponential backoff with optional full jitter.
 *
 * @param attempt - 1 for the first retry, 2 for the second, etc.
 * @param rng - injectable randomness (testability). Defaults to Math.random.
 */
export function computeBackoff(
  attempt: number,
  options: BackoffOptions = {},
  rng: () => number = Math.random,
): number {
  if (attempt < 1) return 0;
  const { baseMs, maxMs, factor, jitter } = { ...DEFAULTS, ...options };

  const exponential = baseMs * Math.pow(factor, attempt - 1);
  const capped = Math.min(exponential, maxMs);

  if (!jitter) return Math.round(capped);

  // Full jitter: random value in [0, capped].
  return Math.round(rng() * capped);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
