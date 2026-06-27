import { describe, expect, it } from "vitest";
import { computeBackoff } from "../src/backoff.js";

describe("computeBackoff", () => {
  it("returns 0 for attempt < 1", () => {
    expect(computeBackoff(0)).toBe(0);
    expect(computeBackoff(-3)).toBe(0);
  });

  it("grows exponentially without jitter", () => {
    const opts = { baseMs: 100, factor: 2, jitter: false };
    expect(computeBackoff(1, opts)).toBe(100);
    expect(computeBackoff(2, opts)).toBe(200);
    expect(computeBackoff(3, opts)).toBe(400);
    expect(computeBackoff(4, opts)).toBe(800);
  });

  it("caps at maxMs", () => {
    const opts = { baseMs: 1000, factor: 10, maxMs: 5000, jitter: false };
    expect(computeBackoff(5, opts)).toBe(5000);
  });

  it("applies full jitter within [0, capped]", () => {
    const opts = { baseMs: 100, factor: 2, jitter: true };
    // rng = 0 -> 0, rng = 1 -> capped
    expect(computeBackoff(3, opts, () => 0)).toBe(0);
    expect(computeBackoff(3, opts, () => 1)).toBe(400);
    expect(computeBackoff(3, opts, () => 0.5)).toBe(200);
  });
});
