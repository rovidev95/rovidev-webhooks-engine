import { describe, expect, it, vi } from "vitest";
import { WebhookEngine } from "../src/engine.js";
import { MemoryIdempotencyStore } from "../src/stores/memory-store.js";
import { NonRetryableError } from "../src/errors.js";
import type { DeadLetter, WebhookEvent } from "../src/types.js";

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "evt_1",
    type: "payment.succeeded",
    payload: { amount: 1000 },
    receivedAt: Date.now(),
    ...overrides,
  };
}

const noSleep = async () => {};

describe("WebhookEngine", () => {
  it("processes a successful event exactly once", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const engine = new WebhookEngine({ sleepFn: noSleep }).on(
      "payment.succeeded",
      handler,
    );

    const result = await engine.process(makeEvent());
    expect(result.status).toBe("processed");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("treats a replayed event id as a duplicate", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const engine = new WebhookEngine({ sleepFn: noSleep }).on(
      "payment.succeeded",
      handler,
    );

    await engine.process(makeEvent());
    const second = await engine.process(makeEvent());

    expect(second.status).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValueOnce(undefined);

    const engine = new WebhookEngine({
      sleepFn: noSleep,
      maxAttempts: 5,
    }).on("payment.succeeded", handler);

    const result = await engine.process(makeEvent());
    expect(result.status).toBe("processed");
    expect(result.attempts).toBe(3);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("dead-letters after exhausting retries", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("always fails"));
    const dlq: DeadLetter[] = [];
    const engine = new WebhookEngine({
      sleepFn: noSleep,
      maxAttempts: 3,
      deadLetter: (entry) => {
        dlq.push(entry);
      },
    }).on("payment.succeeded", handler);

    const result = await engine.process(makeEvent());
    expect(result.status).toBe("dead_lettered");
    expect(handler).toHaveBeenCalledTimes(3);
    expect(dlq).toHaveLength(1);
    expect(dlq[0]?.error).toBe("always fails");
  });

  it("does not retry NonRetryableError", async () => {
    const handler = vi
      .fn()
      .mockRejectedValue(new NonRetryableError("invalid payload"));
    const dlq: DeadLetter[] = [];
    const engine = new WebhookEngine({
      sleepFn: noSleep,
      maxAttempts: 5,
      deadLetter: (entry) => {
        dlq.push(entry);
      },
    }).on("payment.succeeded", handler);

    const result = await engine.process(makeEvent());
    expect(result.status).toBe("dead_lettered");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(dlq).toHaveLength(1);
  });

  it("marks unknown event types as ignored", async () => {
    const engine = new WebhookEngine({ sleepFn: noSleep });
    const result = await engine.process(
      makeEvent({ type: "unknown.type", id: "evt_unknown" }),
    );
    expect(result.status).toBe("ignored");
  });

  it("routes to the fallback handler when no specific match", async () => {
    const fallback = vi.fn().mockResolvedValue(undefined);
    const engine = new WebhookEngine({ sleepFn: noSleep }).onAny(fallback);
    const result = await engine.process(
      makeEvent({ type: "whatever", id: "evt_fallback" }),
    );
    expect(result.status).toBe("processed");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("retries a previously failed event on a new process() call", async () => {
    const store = new MemoryIdempotencyStore();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(undefined);

    const engine = new WebhookEngine({
      store,
      sleepFn: noSleep,
      maxAttempts: 1,
    }).on("payment.succeeded", handler);

    const first = await engine.process(makeEvent());
    expect(first.status).toBe("dead_lettered");

    // Re-deliver: should attempt again since previous state is "failed".
    const second = await engine.process(makeEvent());
    expect(second.status).toBe("processed");
  });
});
