import { describe, expect, it } from "vitest";
import { MemoryIdempotencyStore } from "../src/stores/memory-store.js";

describe("MemoryIdempotencyStore", () => {
  it("returns 'new' the first time and 'in_progress' on a concurrent begin", async () => {
    const store = new MemoryIdempotencyStore();
    const first = await store.begin("evt_1");
    expect(first.kind).toBe("new");
    const second = await store.begin("evt_1");
    expect(second.kind).toBe("in_progress");
  });

  it("reports 'completed' as duplicate after complete()", async () => {
    const store = new MemoryIdempotencyStore();
    await store.begin("evt_2");
    await store.complete("evt_2");
    const again = await store.begin("evt_2");
    expect(again.kind).toBe("completed");
  });

  it("allows retry after fail() and counts attempts", async () => {
    const store = new MemoryIdempotencyStore();
    await store.begin("evt_3");
    await store.fail("evt_3", "boom");
    const retry = await store.begin("evt_3");
    expect(retry.kind).toBe("failed");
    expect(store.snapshot("evt_3")?.error).toBe("boom");
  });

  it("evicts completed records after TTL", async () => {
    let clock = 1_000;
    const store = new MemoryIdempotencyStore({
      ttlMs: 100,
      now: () => clock,
    });
    await store.begin("evt_4");
    await store.complete("evt_4");
    clock += 1_000; // advance beyond TTL
    const after = await store.begin("evt_4");
    expect(after.kind).toBe("new");
  });
});
