/**
 * Memory Manager — the main orchestrator for the memory system.
 * Coordinates vector storage, graph memory, importance scoring,
 * and retention policies into a unified API.
 */

import type { MemoryEntry } from "@teleton/core/domain/agent.interface.js";
import type { MemoryRepository } from "@teleton/core/ports/repository.port.js";
import type { EventBus } from "@teleton/core/domain/events.js";
import type { SemanticSearch } from "./semantic-search.js";
import type { HybridRetrieval, HybridSearchResult } from "./hybrid-retrieval.js";
import type { ImportanceScorer } from "./importance-scorer.js";
import type { RetentionPolicy } from "./retention-policy.js";
import type { MemoryCompaction } from "./compaction.js";
import type { GraphStore } from "./graph-store.js";
import type { EntityExtractor } from "./entity-extractor.js";
import type { GraphQuery, SubgraphResult } from "./graph-query.js";

export interface MemoryManagerConfig {
  enableGraphMemory?: boolean;
  enableCompaction?: boolean;
  autoIndex?: boolean;
}

export interface StoreOptions {
  skipGraphExtraction?: boolean;
  skipIndexing?: boolean;
}

export interface SearchOptions {
  topK?: number;
  includeGraph?: boolean;
  threshold?: number;
}

export interface EnrichedSearchResult {
  results: HybridSearchResult[];
  graphContext?: SubgraphResult;
}

/**
 * Unified memory manager that integrates all memory subsystems.
 */
export class MemoryManager {
  private readonly config: Required<MemoryManagerConfig>;

  constructor(
    private readonly memoryRepository: MemoryRepository,
    private readonly semanticSearch: SemanticSearch,
    private readonly hybridRetrieval: HybridRetrieval,
    private readonly scorer: ImportanceScorer,
    private readonly retentionPolicy: RetentionPolicy,
    private readonly compaction: MemoryCompaction,
    private readonly eventBus: EventBus,
    private readonly graphStore?: GraphStore,
    private readonly entityExtractor?: EntityExtractor,
    private readonly graphQuery?: GraphQuery,
    config: MemoryManagerConfig = {}
  ) {
    this.config = {
      enableGraphMemory: config.enableGraphMemory ?? (!!graphStore && !!entityExtractor),
      enableCompaction: config.enableCompaction ?? true,
      autoIndex: config.autoIndex ?? true,
    };
  }

  /**
   * Store a new memory entry, optionally indexing it for semantic search
   * and extracting entities for graph memory.
   */
  async store(entry: Omit<MemoryEntry, "id">, options: StoreOptions = {}): Promise<MemoryEntry> {
    const stored = await this.memoryRepository.store(entry);

    if (this.config.autoIndex && !options.skipIndexing) {
      await this.semanticSearch.index(stored);
    }

    if (
      this.config.enableGraphMemory &&
      !options.skipGraphExtraction &&
      this.entityExtractor &&
      this.graphStore
    ) {
      await this.extractAndStoreGraph(stored);
    }

    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "memory.stored",
      timestamp: new Date(),
      payload: { memoryId: stored.id, tags: stored.tags },
      source: "memory-manager",
    });

    return stored;
  }

  /**
   * Search memories using hybrid retrieval (semantic + keyword),
   * optionally enriched with graph context.
   */
  async search(query: string, options: SearchOptions = {}): Promise<EnrichedSearchResult> {
    const { topK = 10, includeGraph = false, threshold } = options;

    const results = await this.hybridRetrieval.search(query, {
      topK,
      semanticThreshold: threshold,
    });

    // Record access for importance scoring
    for (const result of results) {
      this.scorer.recordAccess(result.entry.id);
    }

    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "memory.retrieved",
      timestamp: new Date(),
      payload: { query, resultCount: results.length },
      source: "memory-manager",
    });

    let graphContext: SubgraphResult | undefined;
    if (includeGraph && this.graphStore && this.graphQuery && results.length > 0) {
      graphContext = await this.getGraphContext(query);
    }

    return { results, graphContext };
  }

  /**
   * Pin a memory to prevent it from being evicted or compacted.
   */
  pin(memoryId: string): void {
    this.scorer.pin(memoryId);
  }

  /**
   * Unpin a memory, making it eligible for eviction.
   */
  unpin(memoryId: string): void {
    this.scorer.unpin(memoryId);
  }

  /**
   * Delete a memory and remove it from all indexes.
   */
  async forget(memoryId: string): Promise<void> {
    await this.memoryRepository.delete(memoryId);
    await this.semanticSearch.removeFromIndex(memoryId);
  }

  /**
   * Run a maintenance cycle: compaction + retention enforcement.
   */
  async runMaintenance(): Promise<{
    compactedCount: number;
    summariesCreated: number;
  }> {
    if (!this.config.enableCompaction) {
      return { compactedCount: 0, summariesCreated: 0 };
    }

    // Get all memories and evaluate retention
    const allMemories = await this.memoryRepository.search("", 10000);
    const evictionCandidates = this.retentionPolicy.getEvictionCandidates(allMemories);

    const compactionResult = await this.compaction.compact(evictionCandidates.map((c) => c.entry));

    return {
      compactedCount: compactionResult.compactedCount,
      summariesCreated: compactionResult.summariesCreated,
    };
  }

  private async extractAndStoreGraph(entry: MemoryEntry): Promise<void> {
    if (!this.entityExtractor || !this.graphStore) return;

    const { entities, relations } = await this.entityExtractor.extract(entry.content);

    // Add nodes
    const nodeMap = new Map<string, string>(); // label -> nodeId
    for (const entity of entities) {
      const existing = this.graphStore.findNodesByLabel(entity.label);
      if (existing.length > 0) {
        nodeMap.set(entity.label, existing[0].id);
      } else {
        const node = this.graphStore.addNode({
          type: entity.type,
          label: entity.label,
          properties: { ...entity.properties, memoryId: entry.id },
        });
        nodeMap.set(entity.label, node.id);
      }
    }

    // Add edges
    for (const relation of relations) {
      const sourceId = nodeMap.get(relation.sourceLabel);
      const targetId = nodeMap.get(relation.targetLabel);
      if (sourceId && targetId) {
        this.graphStore.addEdge({
          sourceId,
          targetId,
          type: relation.type as
            | "mentions"
            | "caused_by"
            | "related_to"
            | "part_of"
            | "follows"
            | "similar_to",
          weight: relation.weight,
          properties: { memoryId: entry.id },
        });
      }
    }
  }

  private async getGraphContext(query: string): Promise<SubgraphResult | undefined> {
    if (!this.graphStore || !this.graphQuery) return undefined;

    // Find nodes matching the query
    const matchingNodes = this.graphStore.findNodesByLabel(query);
    if (matchingNodes.length === 0) return undefined;

    // Get subgraph around the first matching node
    return this.graphQuery.getSubgraph(matchingNodes[0].id, {
      maxDepth: 2,
      maxResults: 20,
    });
  }
}
