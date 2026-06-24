import { describe, it, expect, beforeEach } from "vitest";
import { AuditStore } from "../../packages/security/src/audit-store.js";
import { createAuditEvent } from "../../packages/security/src/audit-event.js";
import type { AuditEvent } from "../../packages/security/src/audit-event.js";

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return createAuditEvent({
    category: "agent_action",
    action: "agent.tool_call",
    outcome: "success",
    severity: "info",
    actor: { type: "agent", id: "agent-1" },
    ...overrides,
  }) as AuditEvent;
}

describe("AuditStore", () => {
  let store: AuditStore;

  beforeEach(() => {
    store = new AuditStore();
  });

  it("starts empty", () => {
    expect(store.size).toBe(0);
    expect(store.getAll()).toHaveLength(0);
  });

  it("appends an event and returns it with hash fields", async () => {
    const event = makeEvent();
    const stored = await store.append(event);
    expect(stored.hash).toBeTruthy();
    expect(stored.previousHash).toBe("");
    expect(store.size).toBe(1);
  });

  it("chains hashes across multiple appends", async () => {
    const e1 = await store.append(makeEvent());
    const e2 = await store.append(makeEvent());
    expect(e2.previousHash).toBe(e1.hash);
    expect(e2.hash).not.toBe(e1.hash);
  });

  it("verifyIntegrity returns true for an untampered store", async () => {
    await store.append(makeEvent());
    await store.append(makeEvent());
    expect(await store.verifyIntegrity()).toBe(true);
  });

  it("getAll returns events newest-first", async () => {
    await store.append(makeEvent({ action: "first" }));
    await store.append(makeEvent({ action: "second" }));
    const all = store.getAll();
    expect(all[0].action).toBe("second");
    expect(all[1].action).toBe("first");
  });

  it("redacts sensitive fields on write", async () => {
    const event = makeEvent({ metadata: { password: "hunter2", normalField: "ok" } });
    const stored = await store.append(event);
    expect(stored.metadata?.["password"]).toBe("[REDACTED]");
    expect(stored.metadata?.["normalField"]).toBe("ok");
  });

  it("redacts nested sensitive metadata on write", async () => {
    const event = makeEvent({
      metadata: {
        request: {
          headers: {
            authorization: "Bearer leaked-token",
          },
        },
        users: [{ password: "nested-password" }],
      },
    });

    const stored = await store.append(event);

    expect(stored.metadata).toEqual({
      request: {
        headers: {
          authorization: "[REDACTED]",
        },
      },
      users: [{ password: "[REDACTED]" }],
    });
  });

  it("does not share retained nested metadata objects with the caller", async () => {
    const metadata = {
      request: {
        body: {
          safeField: "original",
        },
      },
    };
    const event = makeEvent({ metadata });

    await store.append(event);
    metadata.request.body.safeField = "mutated";

    expect(store.getAll()[0].metadata).toEqual({
      request: {
        body: {
          safeField: "original",
        },
      },
    });
    expect(await store.verifyIntegrity()).toBe(true);
  });

  it("enforces maxEvents cap by dropping oldest events", async () => {
    const capped = new AuditStore({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      await capped.append(makeEvent({ action: `action-${i}` }));
    }
    expect(capped.size).toBe(3);
    const all = capped.getAll();
    // Newest events should be kept; oldest dropped
    const actions = all.map((e) => e.action);
    expect(actions).toContain("action-4");
    expect(actions).toContain("action-3");
    expect(actions).toContain("action-2");
    expect(actions).not.toContain("action-0");
  });

  it("verifyIntegrity returns true after maxEvents evicts older events", async () => {
    const capped = new AuditStore({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      await capped.append(makeEvent({ action: `action-${i}` }));
    }

    expect(await capped.verifyIntegrity()).toBe(true);
  });

  it("verifyIntegrity returns false when a surviving event is mutated after eviction", async () => {
    const capped = new AuditStore({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      await capped.append(makeEvent({ action: `action-${i}` }));
    }

    const oldestSurvivor = capped.getAll().at(-1);
    expect(oldestSurvivor).toBeDefined();
    oldestSurvivor!.action = "tampered";

    expect(await capped.verifyIntegrity()).toBe(false);
  });

  it("purgeExpired removes events past their TTL", async () => {
    const shortRetention = new AuditStore({ defaultRetentionMs: 1 }); // 1ms TTL
    await shortRetention.append(makeEvent());
    await new Promise((r) => setTimeout(r, 5));
    const removed = shortRetention.purgeExpired();
    expect(removed).toBe(1);
    expect(shortRetention.size).toBe(0);
  });

  it("getAll filters by time range", async () => {
    const past = new Date(Date.now() - 10_000);
    const future = new Date(Date.now() + 10_000);
    await store.append(makeEvent());
    const results = store.getAll({ since: past, until: future });
    expect(results).toHaveLength(1);
    const empty = store.getAll({ since: future });
    expect(empty).toHaveLength(0);
  });
});
