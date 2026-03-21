import { describe, it, expect, vi } from "vitest";
import { InMemoryEventBus } from "../../packages/infrastructure/src/events/in-memory-event-bus.js";
import type { DomainEvent, EventHandler } from "../../packages/core/src/domain/events.js";

describe("InMemoryEventBus", () => {
  it("should deliver events to subscribed handlers", async () => {
    const bus = new InMemoryEventBus();
    const handler: EventHandler = { handle: vi.fn().mockResolvedValue(undefined) };

    bus.subscribe("test.event", handler);

    const event: DomainEvent = {
      id: "1",
      type: "test.event",
      timestamp: new Date(),
      payload: { key: "value" },
      source: "test",
    };

    await bus.publish(event);

    expect(handler.handle).toHaveBeenCalledWith(event);
  });

  it("should not deliver events to unsubscribed handlers", async () => {
    const bus = new InMemoryEventBus();
    const handler: EventHandler = { handle: vi.fn().mockResolvedValue(undefined) };

    bus.subscribe("test.event", handler);
    bus.unsubscribe("test.event", handler);

    await bus.publish({
      id: "1",
      type: "test.event",
      timestamp: new Date(),
      payload: {},
      source: "test",
    });

    expect(handler.handle).not.toHaveBeenCalled();
  });

  it("should not crash when no handlers exist for event type", async () => {
    const bus = new InMemoryEventBus();

    await expect(
      bus.publish({
        id: "1",
        type: "unhandled.event",
        timestamp: new Date(),
        payload: {},
        source: "test",
      })
    ).resolves.toBeUndefined();
  });

  it("should handle errors in handlers gracefully", async () => {
    const bus = new InMemoryEventBus();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const failingHandler: EventHandler = {
      handle: vi.fn().mockRejectedValue(new Error("handler failed")),
    };
    const successHandler: EventHandler = {
      handle: vi.fn().mockResolvedValue(undefined),
    };

    bus.subscribe("test.event", failingHandler);
    bus.subscribe("test.event", successHandler);

    await bus.publish({
      id: "1",
      type: "test.event",
      timestamp: new Date(),
      payload: {},
      source: "test",
    });

    // Both handlers should be called even if one fails
    expect(failingHandler.handle).toHaveBeenCalled();
    expect(successHandler.handle).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should support multiple handlers for same event type", async () => {
    const bus = new InMemoryEventBus();
    const handler1: EventHandler = { handle: vi.fn().mockResolvedValue(undefined) };
    const handler2: EventHandler = { handle: vi.fn().mockResolvedValue(undefined) };

    bus.subscribe("test.event", handler1);
    bus.subscribe("test.event", handler2);

    await bus.publish({
      id: "1",
      type: "test.event",
      timestamp: new Date(),
      payload: {},
      source: "test",
    });

    expect(handler1.handle).toHaveBeenCalled();
    expect(handler2.handle).toHaveBeenCalled();
  });
});
