import { describe, it, expect } from "vitest";
import { EventStore } from "../../packages/integrations/src/event-store.js";
import { NotFoundError } from "../../packages/core/src/errors/domain-errors.js";
import type { TypedEvent } from "../../packages/integrations/src/event-schema.js";

function makeEvent(id: string, type: string, occurredAt: string, source = "test"): TypedEvent {
  return { id, type, occurredAt, source, payload: { value: id } };
}

describe("EventStore", () => {
  it("should append and retrieve events by ID", () => {
    const store = new EventStore();
    const evt = makeEvent("1", "user.created", "2024-01-01T00:00:00.000Z");
    store.append(evt);
    expect(store.getById("1")).toEqual(evt);
  });

  it("should throw NotFoundError for missing event", () => {
    const store = new EventStore();
    expect(() => store.getById("nope")).toThrow(NotFoundError);
  });

  it("should prune oldest events when maxEvents is exceeded", () => {
    const store = new EventStore({ maxEvents: 3 });
    store.append(makeEvent("1", "t", "2024-01-01T00:00:00.000Z"));
    store.append(makeEvent("2", "t", "2024-01-02T00:00:00.000Z"));
    store.append(makeEvent("3", "t", "2024-01-03T00:00:00.000Z"));
    store.append(makeEvent("4", "t", "2024-01-04T00:00:00.000Z"));
    expect(store.size).toBe(3);
    expect(() => store.getById("1")).toThrow(NotFoundError);
    expect(store.getById("4")).toBeDefined();
  });

  describe("query()", () => {
    it("should filter by typePrefix", () => {
      const store = new EventStore();
      store.append(makeEvent("1", "user.created", "2024-01-01T00:00:00.000Z"));
      store.append(makeEvent("2", "order.placed", "2024-01-02T00:00:00.000Z"));
      const result = store.query({ typePrefix: "user." });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("should filter by source", () => {
      const store = new EventStore();
      store.append(makeEvent("1", "t", "2024-01-01T00:00:00.000Z", "api"));
      store.append(makeEvent("2", "t", "2024-01-01T00:00:00.000Z", "scheduler"));
      expect(store.query({ source: "api" })).toHaveLength(1);
    });

    it("should respect limit", () => {
      const store = new EventStore();
      for (let i = 1; i <= 5; i++) {
        store.append(makeEvent(String(i), "t", `2024-01-0${i}T00:00:00.000Z`));
      }
      expect(store.query({ limit: 2 })).toHaveLength(2);
    });
  });

  describe("project()", () => {
    it("should reconstruct state from events", () => {
      const store = new EventStore();
      store.append(makeEvent("1", "counter.increment", "2024-01-01T00:00:00.000Z"));
      store.append(makeEvent("2", "counter.increment", "2024-01-02T00:00:00.000Z"));
      store.append(makeEvent("3", "counter.decrement", "2024-01-03T00:00:00.000Z"));

      const count = store.project(
        { typePrefix: "counter." },
        {
          initialState: 0,
          apply: (state, event) => (event.type === "counter.increment" ? state + 1 : state - 1),
        }
      );
      expect(count).toBe(1);
    });
  });

  describe("compact()", () => {
    it("should remove events older than retentionMs", () => {
      const store = new EventStore({ retentionMs: 1_000 });
      const oldDate = new Date(Date.now() - 5_000).toISOString();
      const newDate = new Date().toISOString();
      store.append(makeEvent("old", "t", oldDate));
      store.append(makeEvent("new", "t", newDate));
      const pruned = store.compact();
      expect(pruned).toBe(1);
      expect(store.size).toBe(1);
    });

    it("should remove old events even when events are not sorted by occurredAt", () => {
      const store = new EventStore({ retentionMs: 1_000 });
      const oldDate = new Date(Date.now() - 5_000).toISOString();
      const newDate = new Date().toISOString();

      store.append(makeEvent("new-first", "t", newDate));
      store.append(makeEvent("old-middle", "t", oldDate));
      store.append(makeEvent("new-last", "t", newDate));
      store.append(makeEvent("old-last", "t", oldDate));

      const pruned = store.compact();

      expect(pruned).toBe(2);
      expect(store.query().map((event) => event.id)).toEqual(["new-first", "new-last"]);
    });
  });

  describe("export / import", () => {
    it("should export and re-import events without duplicates", () => {
      const store = new EventStore();
      store.append(makeEvent("1", "t", "2024-01-01T00:00:00.000Z"));
      const snapshot = store.export();
      store.import(snapshot); // duplicate — should be ignored
      expect(store.size).toBe(1);
    });

    it("should skip duplicate IDs within a single imported batch", () => {
      const store = new EventStore();

      store.import([
        makeEvent("1", "t", "2024-01-01T00:00:00.000Z"),
        makeEvent("1", "t", "2024-01-02T00:00:00.000Z"),
      ]);

      expect(store.size).toBe(1);
      expect(store.query().map((event) => event.id)).toEqual(["1"]);
    });
  });
});
