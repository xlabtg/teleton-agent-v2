import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStore } from "../../packages/memory/src/graph-store.js";
import { GraphQuery } from "../../packages/memory/src/graph-query.js";

describe("GraphQuery", () => {
  let store: InMemoryGraphStore;
  let query: GraphQuery;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    query = new GraphQuery(store);
  });

  function buildLinearGraph() {
    // A -> B -> C -> D
    const a = store.addNode({ type: "entity", label: "A", properties: {} });
    const b = store.addNode({ type: "entity", label: "B", properties: {} });
    const c = store.addNode({ type: "entity", label: "C", properties: {} });
    const d = store.addNode({ type: "entity", label: "D", properties: {} });

    store.addEdge({ sourceId: a.id, targetId: b.id, type: "follows", weight: 1, properties: {} });
    store.addEdge({ sourceId: b.id, targetId: c.id, type: "follows", weight: 0.8, properties: {} });
    store.addEdge({ sourceId: c.id, targetId: d.id, type: "follows", weight: 0.6, properties: {} });

    return { a, b, c, d };
  }

  describe("bfs", () => {
    it("should traverse from a starting node", () => {
      const { a } = buildLinearGraph();
      const nodes = query.bfs(a.id, { maxDepth: 3 });
      expect(nodes).toHaveLength(4);
    });

    it("should respect maxDepth", () => {
      const { a } = buildLinearGraph();
      const nodes = query.bfs(a.id, { maxDepth: 1 });
      expect(nodes).toHaveLength(2); // A and B
    });

    it("should respect maxResults", () => {
      const { a } = buildLinearGraph();
      const nodes = query.bfs(a.id, { maxDepth: 10, maxResults: 2 });
      expect(nodes).toHaveLength(2);
    });

    it("should filter by edge type", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });
      const c = store.addNode({ type: "entity", label: "C", properties: {} });

      store.addEdge({ sourceId: a.id, targetId: b.id, type: "follows", weight: 1, properties: {} });
      store.addEdge({
        sourceId: a.id,
        targetId: c.id,
        type: "mentions",
        weight: 1,
        properties: {},
      });

      const nodes = query.bfs(a.id, { edgeTypes: ["follows"] });
      expect(nodes).toHaveLength(2); // A and B, not C
    });

    it("should filter by minimum edge weight", () => {
      const { a } = buildLinearGraph();
      const nodes = query.bfs(a.id, { minEdgeWeight: 0.7 });
      expect(nodes).toHaveLength(3); // A, B, C (edge C->D has weight 0.6)
    });
  });

  describe("getSubgraph", () => {
    it("should return nodes and edges within scope", () => {
      const { a } = buildLinearGraph();
      const subgraph = query.getSubgraph(a.id, { maxDepth: 2 });

      expect(subgraph.nodes).toHaveLength(3); // A, B, C
      expect(subgraph.edges).toHaveLength(2); // A->B, B->C
    });
  });

  describe("findPath", () => {
    it("should find shortest path between nodes", () => {
      const { a, d } = buildLinearGraph();
      const path = query.findPath(a.id, d.id);

      expect(path).not.toBeNull();
      expect(path!.nodes).toHaveLength(4);
      expect(path!.edges).toHaveLength(3);
      expect(path!.totalWeight).toBeCloseTo(2.4); // 1 + 0.8 + 0.6
    });

    it("should return null when no path exists", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      store.addNode({ type: "entity", label: "B", properties: {} });
      // No edge between them (directed)

      // findPath only follows outgoing edges
      const path = query.findPath(a.id, "nonexistent");
      expect(path).toBeNull();
    });
  });

  describe("getNeighbors", () => {
    it("should return neighbors sorted by edge weight", () => {
      const a = store.addNode({ type: "entity", label: "A", properties: {} });
      const b = store.addNode({ type: "entity", label: "B", properties: {} });
      const c = store.addNode({ type: "entity", label: "C", properties: {} });

      store.addEdge({
        sourceId: a.id,
        targetId: b.id,
        type: "related_to",
        weight: 0.3,
        properties: {},
      });
      store.addEdge({
        sourceId: a.id,
        targetId: c.id,
        type: "related_to",
        weight: 0.9,
        properties: {},
      });

      const neighbors = query.getNeighbors(a.id);
      expect(neighbors).toHaveLength(2);
      expect(neighbors[0].node.label).toBe("C"); // Higher weight first
      expect(neighbors[1].node.label).toBe("B");
    });
  });
});
