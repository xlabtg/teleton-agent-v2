import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphQuery } from "../packages/memory/src/graph-query.js";
import { InMemoryGraphStore } from "../packages/memory/src/graph-store.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("InMemoryGraphStore access tracking", () => {
  it("does not update accessedAt on getNode reads", () => {
    const store = new InMemoryGraphStore();
    const node = store.addNode({
      type: "entity",
      label: "Alice",
      properties: {},
    });
    const originalAccessedAt = node.accessedAt;

    expect(store.getNode(node.id)).toBe(node);
    expect(node.accessedAt).toBe(originalAccessedAt);
  });

  it("updates accessedAt only when a node is explicitly touched", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new InMemoryGraphStore();
    const node = store.addNode({
      type: "entity",
      label: "Alice",
      properties: {},
    });
    const originalAccessedAt = node.accessedAt;

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));

    expect(store.touchNode(node.id)).toBe(node);
    expect(node.accessedAt.getTime()).toBeGreaterThan(originalAccessedAt.getTime());
  });
});

describe("GraphQuery access tracking", () => {
  it("does not refresh intermediate node accessedAt during traversal", () => {
    const store = new InMemoryGraphStore();
    const query = new GraphQuery(store);
    const start = store.addNode({ type: "entity", label: "Start", properties: {} });
    const intermediate = store.addNode({
      type: "concept",
      label: "Intermediate",
      properties: {},
    });
    const end = store.addNode({ type: "event", label: "End", properties: {} });
    store.addEdge({
      sourceId: start.id,
      targetId: intermediate.id,
      type: "related_to",
      weight: 1,
      properties: {},
    });
    store.addEdge({
      sourceId: intermediate.id,
      targetId: end.id,
      type: "related_to",
      weight: 1,
      properties: {},
    });
    const originalAccessedAt = intermediate.accessedAt;

    expect(query.findPath(start.id, end.id)?.nodes.map((node) => node.id)).toEqual([
      start.id,
      intermediate.id,
      end.id,
    ]);
    expect(intermediate.accessedAt).toBe(originalAccessedAt);
  });
});
