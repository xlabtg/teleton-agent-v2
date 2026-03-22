import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EventSchemaRegistry } from "../../packages/integrations/src/event-schema.js";
import { ValidationError } from "../../packages/core/src/errors/domain-errors.js";

describe("EventSchemaRegistry", () => {
  it("should register and validate a valid payload", () => {
    const registry = new EventSchemaRegistry();
    registry.register({
      type: "user.created",
      payloadSchema: z.object({ userId: z.string() }),
    });
    expect(() => registry.validate("user.created", { userId: "u1" })).not.toThrow();
  });

  it("should throw ValidationError for invalid payload", () => {
    const registry = new EventSchemaRegistry();
    registry.register({
      type: "user.created",
      payloadSchema: z.object({ userId: z.string() }),
    });
    expect(() => registry.validate("user.created", { userId: 123 })).toThrow(ValidationError);
  });

  it("should throw ValidationError for unknown event type", () => {
    const registry = new EventSchemaRegistry();
    expect(() => registry.validate("unknown.type", {})).toThrow(ValidationError);
  });

  it("should overwrite an existing registration", () => {
    const registry = new EventSchemaRegistry();
    registry.register({ type: "foo", payloadSchema: z.object({ a: z.string() }) });
    registry.register({ type: "foo", payloadSchema: z.object({ b: z.number() }) });
    // New schema requires b: number
    expect(() => registry.validate("foo", { b: 1 })).not.toThrow();
    expect(() => registry.validate("foo", { a: "x" })).toThrow(ValidationError);
  });

  it("build() creates a complete typed event", () => {
    const registry = new EventSchemaRegistry();
    registry.register({
      type: "order.placed",
      payloadSchema: z.object({ orderId: z.string() }),
    });
    const event = registry.build("order.placed", { orderId: "o1" }, { source: "shop" });
    expect(event.type).toBe("order.placed");
    expect(event.source).toBe("shop");
    expect(event.payload).toEqual({ orderId: "o1" });
    expect(typeof event.id).toBe("string");
    expect(typeof event.occurredAt).toBe("string");
  });

  it("listTypes() returns all registered types", () => {
    const registry = new EventSchemaRegistry();
    registry.register({ type: "a", payloadSchema: z.unknown() });
    registry.register({ type: "b", payloadSchema: z.unknown() });
    expect(registry.listTypes().sort()).toEqual(["a", "b"]);
  });
});
