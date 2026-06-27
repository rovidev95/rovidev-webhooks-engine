import { describe, expect, it } from "vitest";
import {
  assertValidSignature,
  parseTimestampedSignature,
  sign,
  verifySignature,
} from "../src/signature.js";
import { SignatureVerificationError } from "../src/errors.js";

const SECRET = "whsec_test_secret";

describe("verifySignature (plain HMAC)", () => {
  const body = JSON.stringify({ hello: "world" });

  it("accepts a valid signature", () => {
    const sig = sign(body, SECRET);
    expect(verifySignature(body, sig, { secret: SECRET })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(body, SECRET);
    expect(verifySignature(body + "x", sig, { secret: SECRET })).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = sign(body, "other");
    expect(verifySignature(body, sig, { secret: SECRET })).toBe(false);
  });

  it("assertValidSignature throws on invalid", () => {
    expect(() =>
      assertValidSignature(body, "deadbeef", { secret: SECRET }),
    ).toThrow(SignatureVerificationError);
  });
});

describe("verifySignature (timestamped, replay protection)", () => {
  const body = JSON.stringify({ amount: 100 });
  const ts = 1_700_000_000; // fixed epoch seconds
  const now = () => ts * 1000;

  function header(atSeconds: number): string {
    const v1 = sign(`${atSeconds}.${body}`, SECRET);
    return `t=${atSeconds},v1=${v1}`;
  }

  it("accepts a fresh timestamped signature", () => {
    expect(
      verifySignature(body, header(ts), {
        secret: SECRET,
        toleranceSeconds: 300,
      }, now),
    ).toBe(true);
  });

  it("rejects a stale signature beyond tolerance", () => {
    expect(
      verifySignature(body, header(ts - 600), {
        secret: SECRET,
        toleranceSeconds: 300,
      }, now),
    ).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(
      verifySignature(body, "nonsense", {
        secret: SECRET,
        toleranceSeconds: 300,
      }, now),
    ).toBe(false);
  });
});

describe("parseTimestampedSignature", () => {
  it("parses t and v1", () => {
    expect(parseTimestampedSignature("t=123,v1=abc")).toEqual({
      timestamp: 123,
      signature: "abc",
    });
  });

  it("returns null when incomplete", () => {
    expect(parseTimestampedSignature("v1=abc")).toBeNull();
    expect(parseTimestampedSignature("t=notanumber,v1=abc")).toBeNull();
  });
});
