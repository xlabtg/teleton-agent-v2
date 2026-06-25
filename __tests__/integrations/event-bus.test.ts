import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { EventBus } from "../../packages/integrations/src/event-bus.js";
import { EventSchemaRegistry } from "../../packages/integrations/src/event-schema.js";
import type { TypedEvent } from "../../packages/integrations/src/event-schema.js";

function makeEvent(id: string, type: string, payload: unknown = {}): TypedEvent {
  return { id, type, occurredAt: new Date().toISOString(), source: "test", payload };
}

describe("EventBus", () => {
  describe("subscribe / unsubscribe / publish", () => {
    it("should call subscriber when matching event is published", async () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      const received: TypedEvent[] = [];
      bus.subscribe("user.created", (evt) => {
        received.push(evt);
      });
      await bus.publish(makeEvent("1", "user.created", { userId: "u1" }));
      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({ userId: "u1" });
    });

    it("should not call subscriber for non-matching type", async () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      const handler = vi.fn();
      bus.subscribe("user.created", handler);
      await bus.publish(makeEvent("1", "order.placed"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("wildcard '*' should receive all events", async () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      const received: string[] = [];
      bus.subscribe("*", (evt) => {
        received.push(evt.type);
      });
      await bus.publish(makeEvent("1", "user.created"));
      await bus.publish(makeEvent("2", "order.placed"));
      expect(received).toEqual(["user.created", "order.placed"]);
    });

    it("should unsubscribe using token", async () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      const handler = vi.fn();
      const sub = bus.subscribe("user.created", handler);
      bus.unsubscribe(sub.token);
      await bus.publish(makeEvent("1", "user.created"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("unsubscribe returns false for unknown token", () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      expect(bus.unsubscribe("nonexistent")).toBe(false);
    });
  });

  describe("schema validation", () => {
    it("should validate payload when type is registered", async () => {
      const registry = new EventSchemaRegistry();
      registry.register({
        type: "user.created",
        payloadSchema: z.object({ userId: z.string() }),
      });
      const bus = new EventBus({ schemaRegistry: registry, store: false, deadLetterQueue: false });
      const evt = makeEvent("1", "user.created", { userId: "u1" });
      await expect(bus.publish(evt)).resolves.not.toThrow();
    });

    it("should throw ValidationError for invalid payload", async () => {
      const registry = new EventSchemaRegistry();
      registry.register({
        type: "user.created",
        payloadSchema: z.object({ userId: z.string() }),
      });
      const bus = new EventBus({ schemaRegistry: registry, store: false, deadLetterQueue: false });
      const evt = makeEvent("1", "user.created", { userId: 999 });
      await expect(bus.publish(evt)).rejects.toThrow();
    });
  });

  describe("event persistence", () => {
    it("should persist events to store by default", async () => {
      const bus = new EventBus({ deadLetterQueue: false });
      await bus.publish(makeEvent("1", "t"));
      expect(bus.store?.size).toBe(1);
    });

    it("should not persist when store is disabled", async () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      await bus.publish(makeEvent("1", "t"));
      expect(bus.store).toBeNull();
    });
  });

  describe("dead-letter queue", () => {
    it("should route failed handler errors to DLQ", async () => {
      const bus = new EventBus({ store: false });
      bus.subscribe(
        "bad.event",
        async () => {
          throw new Error("handler error");
        },
        "bad-handler"
      );
      await bus.publish(makeEvent("1", "bad.event"));
      expect(bus.dlq?.size).toBe(1);
      expect(bus.dlq?.listPending()[0].errorMessage).toBe("handler error");
    });

    it("should isolate synchronous handler throws and continue dispatching", async () => {
      const bus = new EventBus({ store: false });
      const healthyHandler = vi.fn();

      bus.subscribe(
        "bad.event",
        () => {
          throw new Error("sync handler error");
        },
        "sync-bad-handler"
      );
      bus.subscribe("bad.event", healthyHandler, "healthy-handler");

      await expect(bus.publish(makeEvent("1", "bad.event"))).resolves.toBeUndefined();

      expect(healthyHandler).toHaveBeenCalledTimes(1);
      expect(bus.dlq?.size).toBe(1);
      expect(bus.dlq?.listPending()[0]).toMatchObject({
        errorMessage: "sync handler error",
        handlerName: "sync-bad-handler",
      });
    });
  });

  describe("publishBatch()", () => {
    it("should publish all events in order", async () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      const received: string[] = [];
      bus.subscribe("t", (evt) => {
        received.push((evt.payload as { v: string }).v);
      });
      await bus.publishBatch([makeEvent("1", "t", { v: "a" }), makeEvent("2", "t", { v: "b" })]);
      expect(received).toEqual(["a", "b"]);
    });
  });

  describe("subscriptionCount", () => {
    it("should track active subscriptions", () => {
      const bus = new EventBus({ store: false, deadLetterQueue: false });
      const s1 = bus.subscribe("t1", () => {});
      bus.subscribe("t2", () => {});
      expect(bus.subscriptionCount).toBe(2);
      bus.unsubscribe(s1.token);
      expect(bus.subscriptionCount).toBe(1);
    });
  });
});
