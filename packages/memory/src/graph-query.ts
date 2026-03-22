/**
 * Graph traversal and query utilities.
 * Supports BFS traversal, weighted path queries,
 * and subgraph extraction for context building.
 */

import type { GraphStore, GraphNode, GraphEdge, EdgeType } from "./graph-store.js";

export interface TraversalOptions {
  maxDepth?: number;
  edgeTypes?: EdgeType[];
  minEdgeWeight?: number;
  maxResults?: number;
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalWeight: number;
}

/**
 * Graph query engine for traversal and subgraph extraction.
 */
export class GraphQuery {
  constructor(private readonly store: GraphStore) {}

  /**
   * Breadth-first traversal from a starting node.
   * Returns all reachable nodes within the depth limit.
   */
  bfs(startNodeId: string, options: TraversalOptions = {}): GraphNode[] {
    const { maxDepth = 3, edgeTypes, minEdgeWeight = 0, maxResults = 50 } = options;

    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];

    visited.add(startNodeId);

    while (queue.length > 0 && result.length < maxResults) {
      const { nodeId, depth } = queue.shift()!;

      const node = this.store.getNode(nodeId);
      if (node) {
        result.push(node);
      }

      if (depth >= maxDepth) continue;

      const edges = this.store.getEdgesFrom(nodeId);
      for (const edge of edges) {
        if (visited.has(edge.targetId)) continue;
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (edge.weight < minEdgeWeight) continue;

        visited.add(edge.targetId);
        queue.push({ nodeId: edge.targetId, depth: depth + 1 });
      }

      // Also traverse incoming edges for undirected-like behavior
      const inEdges = this.store.getEdgesTo(nodeId);
      for (const edge of inEdges) {
        if (visited.has(edge.sourceId)) continue;
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (edge.weight < minEdgeWeight) continue;

        visited.add(edge.sourceId);
        queue.push({ nodeId: edge.sourceId, depth: depth + 1 });
      }
    }

    return result;
  }

  /**
   * Extract a subgraph around a starting node.
   * Returns all nodes and edges within the traversal scope.
   */
  getSubgraph(startNodeId: string, options: TraversalOptions = {}): SubgraphResult {
    const nodes = this.bfs(startNodeId, options);
    const nodeIds = new Set(nodes.map((n) => n.id));

    const edges: GraphEdge[] = [];
    for (const node of nodes) {
      for (const edge of this.store.getEdgesFrom(node.id)) {
        if (nodeIds.has(edge.targetId)) {
          edges.push(edge);
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Find the shortest path between two nodes using BFS.
   */
  findPath(fromId: string, toId: string, options: TraversalOptions = {}): PathResult | null {
    const { maxDepth = 10, edgeTypes, minEdgeWeight = 0 } = options;

    const visited = new Set<string>();
    const parent = new Map<string, { nodeId: string; edge: GraphEdge }>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: fromId, depth: 0 }];

    visited.add(fromId);

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;

      if (nodeId === toId) {
        return this.reconstructPath(fromId, toId, parent);
      }

      if (depth >= maxDepth) continue;

      const edges = this.store.getEdgesFrom(nodeId);
      for (const edge of edges) {
        if (visited.has(edge.targetId)) continue;
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (edge.weight < minEdgeWeight) continue;

        visited.add(edge.targetId);
        parent.set(edge.targetId, { nodeId, edge });
        queue.push({ nodeId: edge.targetId, depth: depth + 1 });
      }
    }

    return null;
  }

  /**
   * Find nodes connected to a given node, sorted by edge weight.
   */
  getNeighbors(
    nodeId: string,
    options: { edgeTypes?: EdgeType[]; minWeight?: number } = {}
  ): Array<{ node: GraphNode; edge: GraphEdge }> {
    const { edgeTypes, minWeight = 0 } = options;

    const results: Array<{ node: GraphNode; edge: GraphEdge }> = [];

    const outEdges = this.store.getEdgesFrom(nodeId);
    for (const edge of outEdges) {
      if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
      if (edge.weight < minWeight) continue;

      const node = this.store.getNode(edge.targetId);
      if (node) {
        results.push({ node, edge });
      }
    }

    const inEdges = this.store.getEdgesTo(nodeId);
    for (const edge of inEdges) {
      if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
      if (edge.weight < minWeight) continue;

      const node = this.store.getNode(edge.sourceId);
      if (node) {
        results.push({ node, edge });
      }
    }

    results.sort((a, b) => b.edge.weight - a.edge.weight);
    return results;
  }

  private reconstructPath(
    fromId: string,
    toId: string,
    parent: Map<string, { nodeId: string; edge: GraphEdge }>
  ): PathResult {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let totalWeight = 0;
    let current = toId;

    while (current !== fromId) {
      const node = this.store.getNode(current);
      if (node) nodes.unshift(node);

      const p = parent.get(current);
      if (!p) break;

      edges.unshift(p.edge);
      totalWeight += p.edge.weight;
      current = p.nodeId;
    }

    const startNode = this.store.getNode(fromId);
    if (startNode) nodes.unshift(startNode);

    return { nodes, edges, totalWeight };
  }
}
