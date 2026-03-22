import { describe, it, expect } from "vitest";
import { DeadLetterQueue } from "../../packages/integrations/src/dead-letter-queue.js";
import type { TypedEvent } from "../../packages/integrations/src/event-schema.js";

function makeEvent(id: string): TypedEvent {
  return {
    id,
    type: "test.event",
    occurredAt: new Date().toISOString(),
    source: "test",
    payload: {},
  };
}

describe("DeadLetterQueue", () => {
  describe("enqueue / listPending", () => {
    it("should enqueue a failed event", () => {
      const dlq = new DeadLetterQueue();
      const evt = makeEvent("1");
      dlq.enqueue(evt, "Connection refused");
      expect(dlq.size).toBe(1);
    });

    it("listPending() should exclude replayed entries", async () => {
      const dlq = new DeadLetterQueue({ maxRetries: 3, retryBaseDelayMs: 0 });
      const entry = dlq.enqueue(makeEvent("1"), "err");
      await dlq.replay(entry.id, async () => {});
      expect(dlq.listPending()).toHaveLength(0);
    });
  });

  describe("replay()", () => {
    it("should mark entry as replayed on success", async () => {
      const dlq = new DeadLetterQueue();
      const entry = dlq.enqueue(makeEvent("1"), "err");
      const ok = await dlq.replay(entry.id, async () => {});
      expect(ok).toBe(true);
      expect(dlq.listPending()).toHaveLength(0);
    });

    it("should return false on replay failure", async () => {
      const dlq = new DeadLetterQueue();
      const entry = dlq.enqueue(makeEvent("1"), "err");
      const ok = await dlq.replay(entry.id, async () => {
        throw new Error("still failing");
      });
      expect(ok).toBe(false);
    });

    it("should return false for unknown entry ID", async () => {
      const dlq = new DeadLetterQueue();
      expect(await dlq.replay("nonexistent", async () => {})).toBe(false);
    });
  });

  describe("retryAll()", () => {
    it("should retry all pending entries and report counts", async () => {
      const dlq = new DeadLetterQueue({ maxRetries: 3, retryBaseDelayMs: 0 });
      dlq.enqueue(makeEvent("1"), "err");
      dlq.enqueue(makeEvent("2"), "err");
      const { success, failed } = await dlq.retryAll(async () => {});
      expect(success).toBe(2);
      expect(failed).toBe(0);
    });

    it("should not retry entries beyond maxRetries", async () => {
      const dlq = new DeadLetterQueue({ maxRetries: 1, retryBaseDelayMs: 0 });
      const entry = dlq.enqueue(makeEvent("1"), "err");
      // Manually exhaust retries
      await dlq.replay(entry.id, async () => {
        throw new Error();
      });
      const { success, failed } = await dlq.retryAll(async () => {});
      expect(success).toBe(0);
      expect(failed).toBe(0); // entry was excluded from retryAll
    });
  });

  describe("listPermanentFailures()", () => {
    it("should list entries that exceeded maxRetries", async () => {
      const dlq = new DeadLetterQueue({ maxRetries: 1, retryBaseDelayMs: 0 });
      const entry = dlq.enqueue(makeEvent("1"), "err");
      await dlq.replay(entry.id, async () => {
        throw new Error();
      });
      expect(dlq.listPermanentFailures()).toHaveLength(1);
    });
  });

  describe("remove() / purgeReplayed()", () => {
    it("should remove by ID", () => {
      const dlq = new DeadLetterQueue();
      const entry = dlq.enqueue(makeEvent("1"), "err");
      expect(dlq.remove(entry.id)).toBe(true);
      expect(dlq.size).toBe(0);
    });

    it("purgeReplayed() should discard only replayed entries", async () => {
      const dlq = new DeadLetterQueue();
      const e1 = dlq.enqueue(makeEvent("1"), "err");
      dlq.enqueue(makeEvent("2"), "err");
      await dlq.replay(e1.id, async () => {});
      const discarded = dlq.purgeReplayed();
      expect(discarded).toBe(1);
      expect(dlq.size).toBe(1);
    });
  });

  describe("maxEntries cap", () => {
    it("should drop oldest entries when cap is exceeded", () => {
      const dlq = new DeadLetterQueue({ maxEntries: 2 });
      dlq.enqueue(makeEvent("1"), "err");
      dlq.enqueue(makeEvent("2"), "err");
      dlq.enqueue(makeEvent("3"), "err");
      expect(dlq.size).toBe(2);
    });
  });
});
