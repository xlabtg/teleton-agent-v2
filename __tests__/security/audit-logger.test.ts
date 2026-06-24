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
    expect(errLogger.failureCount).toBe(1);
  });

  it("logs store failures by default instead of swallowing them silently", async () => {
    const broken = {
      append: vi.fn().mockRejectedValue(new Error("store failure")),
      getAll: vi.fn(),
      verifyIntegrity: vi.fn(),
      purgeExpired: vi.fn(),
      size: 0,
    } as unknown as AuditStore;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const errLogger = new AuditLogger(broken);

    try {
      errLogger.logSuccess(ACTOR, "test", "system");
      await flush();

      expect(consoleError).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledWith(
        "Audit log store write failed",
        expect.objectContaining({
          action: "test",
          category: "system",
          err: expect.any(Error),
        })
      );
      expect(errLogger.failureCount).toBe(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("logAndWait resolves with the stored event after append succeeds", async () => {
    const event = await logger.logAndWait(ACTOR, "durable.ok", "system", "success", "info");

    expect(event?.action).toBe("durable.ok");
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]).toMatchObject({
      id: event?.id,
      action: "durable.ok",
      outcome: "success",
    });
  });

  it("logAndWait routes store failures to onError and rethrows", async () => {
    const error = new Error("store failure");
    const broken = {
      append: vi.fn().mockRejectedValue(error),
      getAll: vi.fn(),
      verifyIntegrity: vi.fn(),
      purgeExpired: vi.fn(),
      size: 0,
    } as unknown as AuditStore;
    const onError = vi.fn();
    const errLogger = new AuditLogger(broken, { onError });

    await expect(
      errLogger.logAndWait(ACTOR, "durable.fail", "system", "failure", "error")
    ).rejects.toThrow("store failure");

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ action: "durable.fail" })
    );
    expect(errLogger.failureCount).toBe(1);
  });
});
