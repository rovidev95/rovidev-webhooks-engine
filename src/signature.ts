import { createHmac, timingSafeEqual } from "node:crypto";
import { SignatureVerificationError } from "./errors.js";

export interface SignatureOptions {
  /** Shared secret used to compute the HMAC. */
  secret: string;
  /** Hash algorithm. Default: "sha256". */
  algorithm?: string;
  /**
   * Maximum allowed age of the signed timestamp, in seconds. When provided, the
   * signed payload is expected to be `${timestamp}.${rawBody}` (Stripe-style)
   * and stale signatures are rejected to mitigate replay attacks.
   */
  toleranceSeconds?: number;
}

/**
 * Compute an HMAC hex signature for a raw payload.
 */
export function sign(
  rawBody: string,
  secret: string,
  algorithm = "sha256",
): string {
  return createHmac(algorithm, secret).update(rawBody, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify an HMAC signature in constant time. Returns true/false without
 * throwing — use {@link assertValidSignature} when you want to fail hard.
 */
export function verifySignature(
  rawBody: string,
  signature: string,
  options: SignatureOptions,
  now: () => number = Date.now,
): boolean {
  const { secret, algorithm = "sha256", toleranceSeconds } = options;

  if (toleranceSeconds != null) {
    const parsed = parseTimestampedSignature(signature);
    if (!parsed) return false;
    const ageSeconds = Math.abs(now() / 1000 - parsed.timestamp);
    if (ageSeconds > toleranceSeconds) return false;
    const expected = sign(`${parsed.timestamp}.${rawBody}`, secret, algorithm);
    return safeEqualHex(expected, parsed.signature);
  }

  const expected = sign(rawBody, secret, algorithm);
  return safeEqualHex(expected, signature.trim());
}

/**
 * Like {@link verifySignature} but throws {@link SignatureVerificationError}.
 */
export function assertValidSignature(
  rawBody: string,
  signature: string,
  options: SignatureOptions,
  now: () => number = Date.now,
): void {
  if (!verifySignature(rawBody, signature, options, now)) {
    throw new SignatureVerificationError();
  }
}

interface ParsedSignature {
  timestamp: number;
  signature: string;
}

/** Parse a `t=<ts>,v1=<hex>` style header (Stripe-compatible). */
export function parseTimestampedSignature(
  header: string,
): ParsedSignature | null {
  const parts = header.split(",").map((p) => p.trim());
  let timestamp: number | undefined;
  let signature: string | undefined;
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t" && value) timestamp = Number(value);
    if ((key === "v1" || key === "v0") && value) signature = value;
  }
  if (timestamp == null || Number.isNaN(timestamp) || !signature) return null;
  return { timestamp, signature };
}
