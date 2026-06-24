import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStore } from "../../packages/memory/src/graph-store.js";

describe("InMemoryGraphStore", () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    store = new InMemoryGraphStore();
  });

  describe("nodes", () => {
    it("should add and retrieve nodes", () => {
      const node = store.addNode({
        type: "entity",
        label: "Alice",
        properties: { role: "user" },
      });

      expect(node.id).toBeDefined();
      expect(node.label).toBe("Alice");
      expect(node.type).toBe("entity");

      const retrieved = store.getNode(node.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.label).toBe("Alice");
    });

    it("should find nodes by normalized exact label", () => {
      store.addNode({ type: "entity", label: "Alice", properties: {} });
      store.addNode({ type: "entity", label: "Bob", properties: {} });
      store.addNode({ type: "concept", label: "alice in wonderland", properties: {} });

      expect(store.findNodesByLabel("alice")).toHaveLength(1);
      expect(store.findNodesByLabel(" Alice ")).toHaveLength(1);
      expect(store.findNodesByLabel("alice in wonderland")).toHaveLength(1);
    });

    it("should find nodes by type", () => {
      store.addNode({ type: "entity", label: "Alice", properties: {} });
      store.addNode({ type: "concept", label: "AI", properties: {} });
      store.addNode({ type: "entity", label: "Bob", properties: {} });

      expect(store.findNodesByType("entity")).toHaveLength(2);
      expect(store.findNodesByType("concept")).toHaveLength(1);
    });

    it("should update nodes", () => {
      const node = store.addNode({ type: "entity", label: "Alice", properties: {} });

      const updated = store.updateNode(node.id, { label: "Alice Smith" });
      expect(updated!.label).toBe("Alice Smith");
    });

    it("should remove nodes and their edges", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });
      store.addEdge({
        sourceId: a.id,
        targetId: b.id,
        type: "related_to",
        weight: 1,
        properties: {},
      });

      expect(store.edgeCount()).toBe(1);
      store.removeNode(a.id);
      expect(store.nodeCount()).toBe(1);
      expect(store.edgeCount()).toBe(0);
    });
  });

  describe("edges", () => {
    it("should add edges between nodes", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });

      const edge = store.addEdge({
        sourceId: a.id,
        targetId: b.id,
        type: "related_to",
        weight: 0.8,
        properties: {},
      });

      expect(edge.id).toBeDefined();
      expect(edge.weight).toBe(0.8);
    });

    it("should throw when adding edge to nonexistent node", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });

      expect(() =>
        store.addEdge({
          sourceId: a.id,
          targetId: "nonexistent",
          type: "related_to",
          weight: 1,
          properties: {},
        })
      ).toThrow("Target node");
    });

    it("should get edges by direction", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });
      const c = store.addNode({ type: "entity", label: "C", properties: {} });

      store.addEdge({
        sourceId: a.id,
        targetId: b.id,
        type: "related_to",
        weight: 1,
        properties: {},
      });
      store.addEdge({
        sourceId: a.id,
        targetId: c.id,
        type: "mentions",
        weight: 0.5,
        properties: {},
      });
      store.addEdge({
        sourceId: c.id,
        targetId: a.id,
        type: "caused_by",
        weight: 0.3,
        properties: {},
      });

      expect(store.getEdgesFrom(a.id)).toHaveLength(2);
      expect(store.getEdgesTo(a.id)).toHaveLength(1);
      expect(store.getEdgesFrom(a.id, "mentions")).toHaveLength(1);
    });

    it("should find an edge by source, target, and type", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });
      const c = store.addNode({ type: "entity", label: "C", properties: {} });

      const edge = store.addEdge({
        sourceId: a.id,
        targetId: b.id,
        type: "related_to",
        weight: 0.5,
        properties: {},
      });
      store.addEdge({
        sourceId: a.id,
        targetId: c.id,
        type: "related_to",
        weight: 0.8,
        properties: {},
      });

      expect(store.findEdge(a.id, b.id, "related_to")).toBe(edge);
      expect(store.findEdge(a.id, b.id, "mentions")).toBeUndefined();
      expect(store.findEdge(b.id, a.id, "related_to")).toBeUndefined();
    });

    it("should update edge weight", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });
      const edge = store.addEdge({
        sourceId: a.id,
        targetId: b.id,
        type: "related_to",
        weight: 0.5,
        properties: {},
      });

      const updated = store.updateEdgeWeight(edge.id, 0.9);
      expect(updated).toBe(true);

      const edges = store.getEdgesFrom(a.id);
      expect(edges[0].weight).toBe(0.9);
    });

    it("should remove edges", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });
      const edge = store.addEdge({
        sourceId: a.id,
        targetId: b.id,
        type: "related_to",
        weight: 1,
        properties: {},
      });

      expect(store.removeEdge(edge.id)).toBe(true);
      expect(store.edgeCount()).toBe(0);
    });
  });

  it("should clear all data", () => {
    const a = store.addNode({ type: "entity", label: "A", properties: {} });
    const b = store.addNode({ type: "entity", label: "B", properties: {} });
    store.addEdge({
      sourceId: a.id,
      targetId: b.id,
      type: "related_to",
      weight: 1,
      properties: {},
    });

    store.clear();
    expect(store.nodeCount()).toBe(0);
    expect(store.edgeCount()).toBe(0);
  });

  it("should evict the oldest nodes and their edges when maxNodes is reached", () => {
    store = new InMemoryGraphStore({ maxNodes: 2 });

    const a = store.addNode({ type: "entity", label: "A", properties: {} });
    const b = store.addNode({ type: "entity", label: "B", properties: {} });
    store.addEdge({
      sourceId: a.id,
      targetId: b.id,
      type: "related_to",
      weight: 1,
      properties: {},
    });
    const c = store.addNode({ type: "entity", label: "C", properties: {} });

    expect(store.getNode(a.id)).toBeUndefined();
    expect(store.getNode(b.id)).toBeDefined();
    expect(store.getNode(c.id)).toBeDefined();
    expect(store.nodeCount()).toBe(2);
    expect(store.edgeCount()).toBe(0);
  });

  it("should evict the oldest edges when maxEdges is reached", () => {
    store = new InMemoryGraphStore({ maxEdges: 1 });
    const a = store.addNode({ type: "entity", label: "A", properties: {} });
    const b = store.addNode({ type: "entity", label: "B", properties: {} });
    const c = store.addNode({ type: "entity", label: "C", properties: {} });

    const first = store.addEdge({
      sourceId: a.id,
      targetId: b.id,
      type: "related_to",
      weight: 1,
      properties: {},
    });
    const second = store.addEdge({
      sourceId: b.id,
      targetId: c.id,
      type: "related_to",
      weight: 1,
      properties: {},
    });

    expect(store.edgeCount()).toBe(1);
    expect(store.removeEdge(first.id)).toBe(false);
    expect(store.removeEdge(second.id)).toBe(true);
  });
});
