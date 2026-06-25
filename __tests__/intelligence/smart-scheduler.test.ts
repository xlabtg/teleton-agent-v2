import { describe, it, expect, beforeEach } from "vitest";
import { SmartScheduler } from "../../packages/intelligence/src/smart-scheduler.js";

const REF = new Date("2024-06-15T08:00:00Z");

function makeScheduler() {
  return new SmartScheduler({ referenceDate: REF });
}

describe("SmartScheduler", () => {
  let scheduler: SmartScheduler;

  beforeEach(() => {
    scheduler = makeScheduler();
  });

  it("should return null entry for unrecognized text", async () => {
    const result = await scheduler.schedule({ userId: "u1", text: "how are you?" });
    expect(result.entry).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("should create a schedule entry from natural language", async () => {
    const result = await scheduler.schedule({
      userId: "u1",
      text: "remind me tomorrow at 9am to review the report",
    });
    expect(result.entry).not.toBeNull();
    expect(result.entry!.userId).toBe("u1");
    expect(result.entry!.status).toBe("pending");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should report conflicts when schedules overlap", async () => {
    await scheduler.schedule({
      userId: "u1",
      text: "remind me tomorrow at 9am to do A",
    });
    const second = await scheduler.schedule({
      userId: "u1",
      text: "remind me tomorrow at 9am to do B",
    });
    expect(second.conflicts.length).toBeGreaterThan(0);
  });

  it("listForUser() should return pending entries", async () => {
    await scheduler.schedule({ userId: "u1", text: "remind me tomorrow to call Bob" });
    const entries = scheduler.listForUser("u1");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("cancel() should cancel an entry", async () => {
    const result = await scheduler.schedule({
      userId: "u1",
      text: "remind me tomorrow to call Bob",
    });
    if (result.entry) {
      scheduler.cancel(result.entry.id);
      expect(scheduler.listForUser("u1")).toHaveLength(0);
    }
  });

  it("should deliver notification on tick() when entry is due", async () => {
    const delivered: string[] = [];
    scheduler.registerChannel("in-app", async (payload) => {
      delivered.push(payload.entry.action);
    });

    // Create a schedule already in the past so it's due immediately
    scheduler.createDirect({
      userId: "u1",
      action: "Check email",
      triggerAt: new Date(REF.getTime() - 1000), // 1 second ago
    });

    await scheduler.tick();
    expect(delivered).toContain("Check email");
  });

  it("should mark entry as triggered after tick()", async () => {
    scheduler.registerChannel("in-app", async () => {});

    const entry = scheduler.createDirect({
      userId: "u1",
      action: "Stand-up meeting",
      triggerAt: new Date(REF.getTime() - 1000),
      recurrence: { kind: "once" },
    });

    await scheduler.tick();
    expect(scheduler.store.get(entry.id)?.status).toBe("triggered");
  });

  it("should advance recurring entry after tick()", async () => {
    scheduler.registerChannel("in-app", async () => {});

    const entry = scheduler.createDirect({
      userId: "u1",
      action: "Daily standup",
      triggerAt: new Date(REF.getTime() - 1000),
      recurrence: { kind: "daily", intervalDays: 1 },
    });

    await scheduler.tick();
    const updated = scheduler.store.get(entry.id);
    expect(updated?.status).toBe("pending");
    expect(updated!.triggerAt.getTime()).toBeGreaterThan(REF.getTime());
  });

  it("should collapse missed recurring intervals into one delivery", async () => {
    const delivered: string[] = [];
    scheduler.registerChannel("in-app", async (payload) => {
      delivered.push(payload.entry.action);
    });

    const entry = scheduler.createDirect({
      userId: "u1",
      action: "Daily standup",
      triggerAt: new Date("2024-06-01T08:00:00Z"),
      recurrence: { kind: "daily", intervalDays: 1 },
    });

    await scheduler.tick();
    await scheduler.tick();

    const updated = scheduler.store.get(entry.id)!;
    expect(delivered).toEqual(["Daily standup"]);
    expect(updated.status).toBe("pending");
    expect(updated.triggerAt.toISOString()).toBe("2024-06-16T08:00:00.000Z");
  });

  it("start() and stop() control the daemon", () => {
    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  it("start() is idempotent", () => {
    scheduler.start();
    scheduler.start(); // should not throw or create duplicate timers
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
  });
});
