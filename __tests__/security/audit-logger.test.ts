import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditStore } from "../../packages/security/src/audit-store.js";
import { AuditLogger } from "../../packages/security/src/audit-logger.js";
import type { AuditActor } from "../../packages/security/src/audit-event.js";

const ACTOR: AuditActor = { type: "user", id: "user-1" };

async function flush() {
  // Flush micro-task queue (multiple ticks so crypto.subtle.digest can settle)
  await new Promise((r) => setTimeout(r, 10));
}

describe("AuditLogger", () => {
  let store: AuditStore;
  let logger: AuditLogger;

  beforeEach(() => {
    store = new AuditStore();
    logger = new AuditLogger(store);
  });

  it("logSuccess stores an event with outcome=success", async () => {
    logger.logSuccess(ACTOR, "test.action", "agent_action");
    await flush();
    const events = store.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("success");
    expect(events[0].action).toBe("test.action");
  });

  it("logBlocked stores an event with outcome=blocked", async () => {
    logger.logBlocked(ACTOR, "test.blocked", "input_validation");
    await flush();
    expect(store.getAll()[0].outcome).toBe("blocked");
  });

  it("logFailure stores an event with outcome=failure and severity=error", async () => {
    logger.logFailure(ACTOR, "test.fail", "authentication");
    await flush();
    const e = store.getAll()[0];
    expect(e.outcome).toBe("failure");
    expect(e.severity).toBe("error");
  });

  it("respects minSeverity and drops low-severity events", async () => {
    logger = new AuditLogger(store, { minSeverity: "error" });
    logger.logSuccess(ACTOR, "ignored", "system");
    logger.logFailure(ACTOR, "kept", "system");
    await flush();
    expect(store.size).toBe(1);
    expect(store.getAll()[0].action).toBe("kept");
  });

  it("respects suppressedCategories", async () => {
    logger = new AuditLogger(store, { suppressedCategories: ["system"] });
    logger.logSuccess(ACTOR, "ignored", "system");
    logger.logSuccess(ACTOR, "kept", "agent_action");
    await flush();
    expect(store.size).toBe(1);
    expect(store.getAll()[0].action).toBe("kept");
  });

  it("wrap logs success on resolution", async () => {
    const result = await logger.wrap(ACTOR, "wrap.op", "data_access", async () => 42);
    expect(result).toBe(42);
    await flush();
    expect(store.getAll()[0].outcome).toBe("success");
  });

  it("wrap logs failure on rejection and rethrows", async () => {
    await expect(
      logger.wrap(ACTOR, "wrap.fail", "data_access", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await flush();
    const e = store.getAll()[0];
    expect(e.outcome).toBe("failure");
    expect((e.metadata as Record<string, string>)["error"]).toBe("boom");
  });

  it("calls onError when store throws", async () => {
    const broken = {
      append: vi.fn().mockRejectedValue(new Error("store failure")),
      getAll: vi.fn(),
      verifyIntegrity: vi.fn(),
      purgeExpired: vi.fn(),
      size: 0,
    } as unknown as AuditStore;
    const onError = vi.fn();
    const errLogger = new AuditLogger(broken, { onError });
    errLogger.logSuccess(ACTOR, "test", "system");
    await flush();
    expect(onError).toHaveBeenCalledOnce();
  });
});
