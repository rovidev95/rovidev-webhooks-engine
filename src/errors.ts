/** Base error for all engine-specific failures. */
export class WebhookEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookEngineError";
  }
}

/** Thrown when signature verification fails. */
export class SignatureVerificationError extends WebhookEngineError {
  constructor(message = "Webhook signature verification failed") {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

/**
 * Throw this from a handler to signal that the failure is permanent and the
 * event should NOT be retried (it goes straight to the dead-letter sink).
 */
export class NonRetryableError extends WebhookEngineError {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
