/**
 * Memory compaction pipeline.
 * Summarizes and archives clusters of low-importance memories,
 * replacing them with a single summary entry.
 */

import type { MemoryEntry } from "@teleton/core/domain/agent.interface.js";
import type { MemoryRepository } from "@teleton/core/ports/repository.port.js";
import type { GraphStore } from "./graph-store.js";
import type { ImportanceScorer } from "./importance-scorer.js";
import type { SemanticSearch } from "./semantic-search.js";

export interface CompactionConfig {
  /** Minimum number of cold memories to trigger compaction. */
  minClusterSize?: number;
  /** Maximum score to be eligible for compaction. */
  maxScoreForCompaction?: number;
  /** Maximum age in milliseconds for compaction eligibility. */
  maxAgeMs?: number;
}

export interface CompactionResult {
  compactedCount: number;
  summariesCreated: number;
  deletedIds: string[];
}

export interface CompactionIndexes {
  semanticSearch?: Pick<SemanticSearch, "removeFromIndex">;
  graphStore?: Pick<GraphStore, "findNodesByType" | "removeNode">;
}

/**
 * Custom summary function type.
 * Receives a group of related memories and returns a summary text.
 */
export type SummaryFunction = (entries: MemoryEntry[]) => Promise<string>;

/**
 * Default summary: concatenates the first sentence from each entry.
 */
async function defaultSummarize(entries: MemoryEntry[]): Promise<string> {
  const snippets = entries.map((e) => {
    const firstSentence = e.content.split(/[.!?]\s/)[0];
    return firstSentence.length > 100 ? firstSentence.substring(0, 100) + "..." : firstSentence;
  });
  return `Summary of ${entries.length} memories: ${snippets.join("; ")}`;
}

/**
 * Compacts low-importance memories into summaries.
 */
export class MemoryCompaction {
  private readonly minClusterSize: number;
  private readonly maxScoreForCompaction: number;
  private readonly maxAgeMs: number;

  constructor(
    private readonly memoryRepository: MemoryRepository,
    private readonly scorer: ImportanceScorer,
    private readonly summarize: SummaryFunction = defaultSummarize,
    config: CompactionConfig = {},
    private readonly indexes: CompactionIndexes = {}
  ) {
    this.minClusterSize = config.minClusterSize ?? 5;
    this.maxScoreForCompaction = config.maxScoreForCompaction ?? 0.3;
    this.maxAgeMs = config.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  /**
   * Run the compaction pipeline.
   * Groups eligible memories by tags, summarizes each group,
   * stores the summary, and deletes the originals.
   */
  async compact(entries: MemoryEntry[]): Promise<CompactionResult> {
    const eligible = this.findEligible(entries);

    if (eligible.length < this.minClusterSize) {
      return { compactedCount: 0, summariesCreated: 0, deletedIds: [] };
    }

    // Group by primary tag (first tag or "untagged")
    const groups = this.groupByTag(eligible);

    const result: CompactionResult = {
      compactedCount: 0,
      summariesCreated: 0,
      deletedIds: [],
    };

    for (const [tag, group] of groups) {
      if (group.length < this.minClusterSize) continue;

      const summaryText = await this.summarize(group);

      // Store the summary as a new memory
      await this.memoryRepository.store({
        content: summaryText,
        importance: 0.4, // Mid-low importance for summaries
        createdAt: new Date(),
        accessedAt: new Date(),
        tags: [tag, "compacted-summary"],
      });

      // Delete the original entries
      for (const entry of group) {
        await this.memoryRepository.delete(entry.id);
        await this.indexes.semanticSearch?.removeFromIndex(entry.id);
        this.removeGraphNodesForMemory(entry.id);
        result.deletedIds.push(entry.id);
      }

      result.compactedCount += group.length;
      result.summariesCreated++;
    }

    return result;
  }

  private findEligible(entries: MemoryEntry[]): MemoryEntry[] {
    const now = Date.now();

    return entries.filter((entry) => {
      const score = this.scorer.score(entry);
      if (score > this.maxScoreForCompaction) return false;

      const age = now - entry.createdAt.getTime();
      if (age < this.maxAgeMs) return false;

      // Don't compact pinned memories
      if (this.scorer.isPinned(entry.id)) return false;

      return true;
    });
  }

  private groupByTag(entries: MemoryEntry[]): Map<string, MemoryEntry[]> {
    const groups = new Map<string, MemoryEntry[]>();

    for (const entry of entries) {
      const tag = entry.tags.length > 0 ? entry.tags[0] : "untagged";
      const group = groups.get(tag) ?? [];
      group.push(entry);
      groups.set(tag, group);
    }

    return groups;
  }

  private removeGraphNodesForMemory(memoryId: string): void {
    const graphStore = this.indexes.graphStore;
    if (!graphStore) return;

    for (const type of ["entity", "concept", "event"] as const) {
      for (const node of graphStore.findNodesByType(type)) {
        if (node.properties.memoryId === memoryId) {
          graphStore.removeNode(node.id);
        }
      }
    }
  }
}
