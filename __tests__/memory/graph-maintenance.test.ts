import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStore } from "../../packages/memory/src/graph-store.js";
import { GraphMaintenance } from "../../packages/memory/src/graph-maintenance.js";

describe("GraphMaintenance", () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    store = new InMemoryGraphStore();
  });

  it("should merge duplicate nodes with same label", () => {
    store.addNode({ type: "entity", label: "Alice", properties: {} });
    store.addNode({ type: "entity", label: "alice", properties: {} });
    store.addNode({ type: "entity", label: "Bob", properties: {} });

    const maintenance = new GraphMaintenance(store);
    const merged = maintenance.mergeDuplicates();

    expect(merged).toBe(1);
    expect(store.nodeCount()).toBe(2); // Alice + Bob
  });

  it("should deduplicate overlapping transferred edges when merging nodes", () => {
    const primary = store.addNode({ type: "entity", label: "Alice", properties: {} });
    const duplicate = store.addNode({ type: "entity", label: "alice", properties: {} });
    const target = store.addNode({ type: "entity", label: "Bob", properties: {} });
    const source = store.addNode({ type: "entity", label: "Carol", properties: {} });

    primary.accessedAt = new Date(Date.now() + 1000);

    store.addEdge({
      sourceId: primary.id,
      targetId: target.id,
      type: "related_to",
      weight: 0.4,
      properties: { existing: true },
    });
    store.addEdge({
      sourceId: duplicate.id,
      targetId: target.id,
      type: "related_to",
      weight: 0.9,
      properties: { transferred: true },
    });
    store.addEdge({
      sourceId: source.id,
      targetId: primary.id,
      type: "mentions",
      weight: 0.8,
      properties: { existing: true },
    });
    store.addEdge({
      sourceId: source.id,
      targetId: duplicate.id,
      type: "mentions",
      weight: 0.3,
      properties: { transferred: true },
    });

    const maintenance = new GraphMaintenance(store);
    const merged = maintenance.mergeDuplicates();

    expect(merged).toBe(1);
    expect(store.edgeCount()).toBe(2);

    const outbound = store.getEdgesFrom(primary.id, "related_to");
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({
      sourceId: primary.id,
      targetId: target.id,
      weight: 0.9,
    });

    const inbound = store.getEdgesTo(primary.id, "mentions");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({
      sourceId: source.id,
      targetId: primary.id,
      weight: 0.8,
    });
  });

  it("should decay edge weights", () => {
    const a = store.addNode({ type: "entity", label: "A", properties: {} });
    const b = store.addNode({ type: "entity", label: "B", properties: {} });
    store.addEdge({
      sourceId: a.id,
      targetId: b.id,
      type: "related_to",
      weight: 1.0,
      properties: {},
    });

    const maintenance = new GraphMaintenance(store, { decayFactor: 0.5 });
    maintenance.decayEdges();

    const edges = store.getEdgesFrom(a.id);
    expect(edges[0].weight).toBeCloseTo(0.5);
  });

  it("should prune edges below minimum weight", () => {
    const a = store.addNode({ type: "entity", label: "A", properties: {} });
    const b = store.addNode({ type: "entity", label: "B", properties: {} });
    const c = store.addNode({ type: "entity", label: "C", properties: {} });

    store.addEdge({
      sourceId: a.id,
      targetId: b.id,
      type: "related_to",
      weight: 0.05,
      properties: {},
    });
    store.addEdge({
      sourceId: a.id,
      targetId: c.id,
      type: "related_to",
      weight: 0.5,
      properties: {},
    });

    const maintenance = new GraphMaintenance(store, { minEdgeWeight: 0.1 });
    const pruned = maintenance.pruneWeakEdges();

    expect(pruned).toBe(1);
    expect(store.edgeCount()).toBe(1);
  });

  it("should prune stale isolated nodes", () => {
    // Create a stale node with old access time
    const node = store.addNode({ type: "entity", label: "Stale", properties: {} });
    // Manually set accessedAt to 60 days ago
    const storedNode = store.getNode(node.id)!;
    storedNode.accessedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    // Create a connected node (should not be pruned even if stale)
    const connected = store.addNode({ type: "entity", label: "Connected", properties: {} });
    const other = store.addNode({ type: "entity", label: "Other", properties: {} });
    store.addEdge({
      sourceId: connected.id,
      targetId: other.id,
      type: "related_to",
      weight: 1,
      properties: {},
    });
    const storedConnected = store.getNode(connected.id)!;
    storedConnected.accessedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const maintenance = new GraphMaintenance(store, {
      maxNodeAgeMs: 30 * 24 * 60 * 60 * 1000,
    });
    const pruned = maintenance.pruneStaleNodes();

    expect(pruned).toBe(1); // Only the isolated stale node
    expect(store.getNode(node.id)).toBeUndefined();
    expect(store.getNode(connected.id)).toBeDefined();
  });

  it("should run full maintenance cycle", () => {
    const a = store.addNode({ type: "entity", label: "A", properties: {} });
    store.addNode({ type: "entity", label: "a", properties: {} });
    const b = store.addNode({ type: "entity", label: "B", properties: {} });

    store.addEdge({
      sourceId: a.id,
      targetId: b.id,
      type: "related_to",
      weight: 0.05,
      properties: {},
    });

    const maintenance = new GraphMaintenance(store, {
      decayFactor: 0.9,
      minEdgeWeight: 0.1,
    });
    const report = maintenance.run();

    expect(report.mergedNodes).toBe(1);
    // After merge, the edge from a->b is transferred, then decayed, then pruned
    expect(report.decayedEdges).toBeGreaterThanOrEqual(0);
  });
});
