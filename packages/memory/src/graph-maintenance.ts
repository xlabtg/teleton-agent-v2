/**
 * Graph maintenance utilities.
 * Handles deduplication, stale node pruning, and edge weight decay.
 */

import type { GraphStore, GraphNode, EdgeType } from "./graph-store.js";

export interface MaintenanceOptions {
  /** Edge weight decay factor per maintenance cycle (0-1). */
  decayFactor?: number;
  /** Minimum edge weight before pruning. */
  minEdgeWeight?: number;
  /** Maximum age in milliseconds before a node is considered stale. */
  maxNodeAgeMs?: number;
  /** Similarity threshold for merging duplicate nodes (0-1). */
  mergeSimilarityThreshold?: number;
}

export interface MaintenanceReport {
  mergedNodes: number;
  prunedEdges: number;
  prunedNodes: number;
  decayedEdges: number;
}

/**
 * Performs graph maintenance operations:
 * - Merges duplicate nodes with similar labels
 * - Prunes stale nodes that haven't been accessed recently
 * - Decays edge weights over time
 * - Removes edges below minimum weight threshold
 */
export class GraphMaintenance {
  private readonly decayFactor: number;
  private readonly minEdgeWeight: number;
  private readonly maxNodeAgeMs: number;
  constructor(
    private readonly store: GraphStore,
    options: MaintenanceOptions = {}
  ) {
    this.decayFactor = options.decayFactor ?? 0.95;
    this.minEdgeWeight = options.minEdgeWeight ?? 0.1;
    this.maxNodeAgeMs = options.maxNodeAgeMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  /**
   * Run a full maintenance cycle.
   */
  run(): MaintenanceReport {
    const report: MaintenanceReport = {
      mergedNodes: 0,
      prunedEdges: 0,
      prunedNodes: 0,
      decayedEdges: 0,
    };

    report.mergedNodes = this.mergeDuplicates();
    report.decayedEdges = this.decayEdges();
    report.prunedEdges = this.pruneWeakEdges();
    report.prunedNodes = this.pruneStaleNodes();

    return report;
  }

  /**
   * Merge nodes with very similar labels (case-insensitive exact match).
   * Transfers all edges from the duplicate to the original.
   */
  mergeDuplicates(): number {
    const labelMap = new Map<string, GraphNode[]>();

    // Group all entity/concept nodes by normalized label
    for (const type of ["entity", "concept", "event"] as const) {
      const nodes = this.store.findNodesByType(type);
      for (const node of nodes) {
        const key = `${node.type}:${node.label.toLowerCase().trim()}`;
        const group = labelMap.get(key) ?? [];
        group.push(node);
        labelMap.set(key, group);
      }
    }

    let merged = 0;
    for (const [, group] of labelMap) {
      if (group.length <= 1) continue;

      // Keep the node that was accessed most recently
      group.sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime());
      const primary = group[0];

      for (let i = 1; i < group.length; i++) {
        const duplicate = group[i];
        this.transferEdges(duplicate.id, primary.id);
        this.store.removeNode(duplicate.id);
        merged++;
      }
    }

    return merged;
  }

  /**
   * Apply decay factor to all edge weights.
   */
  decayEdges(): number {
    let decayed = 0;

    // Iterate all nodes and their outgoing edges
    for (const type of ["entity", "concept", "event"] as const) {
      const nodes = this.store.findNodesByType(type);
      for (const node of nodes) {
        const edges = this.store.getEdgesFrom(node.id);
        for (const edge of edges) {
          const newWeight = edge.weight * this.decayFactor;
          this.store.updateEdgeWeight(edge.id, newWeight);
          decayed++;
        }
      }
    }

    return decayed;
  }

  /**
   * Remove edges that have decayed below the minimum weight threshold.
   */
  pruneWeakEdges(): number {
    let pruned = 0;

    for (const type of ["entity", "concept", "event"] as const) {
      const nodes = this.store.findNodesByType(type);
      for (const node of nodes) {
        const edges = this.store.getEdgesFrom(node.id);
        for (const edge of edges) {
          if (edge.weight < this.minEdgeWeight) {
            this.store.removeEdge(edge.id);
            pruned++;
          }
        }
      }
    }

    return pruned;
  }

  /**
   * Remove nodes that haven't been accessed within the max age window
   * and have no edges connecting them.
   */
  pruneStaleNodes(): number {
    const now = Date.now();
    let pruned = 0;

    for (const type of ["entity", "concept", "event"] as const) {
      const nodes = this.store.findNodesByType(type);
      for (const node of nodes) {
        const age = now - node.accessedAt.getTime();
        if (age <= this.maxNodeAgeMs) continue;

        // Only prune if the node is isolated (no connections)
        const outEdges = this.store.getEdgesFrom(node.id);
        const inEdges = this.store.getEdgesTo(node.id);

        if (outEdges.length === 0 && inEdges.length === 0) {
          this.store.removeNode(node.id);
          pruned++;
        }
      }
    }

    return pruned;
  }

  /**
   * Transfer all edges from one node to another.
   * Used when merging duplicate nodes.
   */
  private transferEdges(fromNodeId: string, toNodeId: string): void {
    const outEdges = this.store.getEdgesFrom(fromNodeId);
    for (const edge of outEdges) {
      if (edge.targetId === toNodeId) continue; // Skip self-loops
      this.addOrUpdateTransferredEdge(
        toNodeId,
        edge.targetId,
        edge.type as EdgeType,
        edge.weight,
        edge.properties
      );
    }

    const inEdges = this.store.getEdgesTo(fromNodeId);
    for (const edge of inEdges) {
      if (edge.sourceId === toNodeId) continue; // Skip self-loops
      this.addOrUpdateTransferredEdge(
        edge.sourceId,
        toNodeId,
        edge.type as EdgeType,
        edge.weight,
        edge.properties
      );
    }
  }

  private addOrUpdateTransferredEdge(
    sourceId: string,
    targetId: string,
    type: EdgeType,
    weight: number,
    properties: Record<string, unknown>
  ): void {
    const existing = this.store.findEdge(sourceId, targetId, type);
    if (existing) {
      this.store.updateEdgeWeight(existing.id, Math.max(existing.weight, weight));
      return;
    }

    this.store.addEdge({
      sourceId,
      targetId,
      type,
      weight,
      properties,
    });
  }
}
