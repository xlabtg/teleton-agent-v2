/**
 * Hybrid retrieval strategy.
 * Merges results from vector (semantic) search and keyword search,
 * applying reciprocal rank fusion to combine rankings.
 */

import type { MemoryEntry } from "@teleton/core/domain/agent.interface.js";
import type { MemoryRepository } from "@teleton/core/ports/repository.port.js";
import type { SemanticSearch, SemanticSearchResult } from "./semantic-search.js";

export interface HybridRetrievalOptions {
  topK?: number;
  semanticWeight?: number;
  keywordWeight?: number;
  semanticThreshold?: number;
}

export interface HybridSearchResult {
  entry: MemoryEntry;
  score: number;
  sources: ("semantic" | "keyword")[];
}

/**
 * Combines semantic vector search with keyword-based search
 * using reciprocal rank fusion (RRF) for result merging.
 */
export class HybridRetrieval {
  private static readonly RRF_K = 60; // Standard RRF constant

  constructor(
    private readonly semanticSearch: SemanticSearch,
    private readonly memoryRepository: MemoryRepository
  ) {}

  /**
   * Perform hybrid search combining semantic and keyword results.
   */
  async search(query: string, options: HybridRetrievalOptions = {}): Promise<HybridSearchResult[]> {
    const { topK = 10, semanticWeight = 0.7, keywordWeight = 0.3, semanticThreshold } = options;

    // Fetch more candidates than needed from each source for better fusion
    const candidateCount = topK * 2;

    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch.search(query, {
        topK: candidateCount,
        threshold: semanticThreshold,
      }),
      this.memoryRepository.search(query, candidateCount),
    ]);

    return this.fuseResults(semanticResults, keywordResults, semanticWeight, keywordWeight, topK);
  }

  /**
   * Merge semantic and keyword results using Reciprocal Rank Fusion.
   * RRF score = sum(weight / (k + rank)) across sources.
   */
  private fuseResults(
    semanticResults: SemanticSearchResult[],
    keywordResults: MemoryEntry[],
    semanticWeight: number,
    keywordWeight: number,
    topK: number
  ): HybridSearchResult[] {
    const scoreMap = new Map<
      string,
      { entry: MemoryEntry; score: number; sources: Set<"semantic" | "keyword"> }
    >();

    const k = HybridRetrieval.RRF_K;

    // Score semantic results by rank
    for (let rank = 0; rank < semanticResults.length; rank++) {
      const { entry } = semanticResults[rank];
      const rrfScore = semanticWeight / (k + rank + 1);

      const existing = scoreMap.get(entry.id);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add("semantic");
      } else {
        scoreMap.set(entry.id, {
          entry,
          score: rrfScore,
          sources: new Set(["semantic"]),
        });
      }
    }

    // Score keyword results by rank
    for (let rank = 0; rank < keywordResults.length; rank++) {
      const entry = keywordResults[rank];
      const rrfScore = keywordWeight / (k + rank + 1);

      const existing = scoreMap.get(entry.id);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add("keyword");
      } else {
        scoreMap.set(entry.id, {
          entry,
          score: rrfScore,
          sources: new Set(["keyword"]),
        });
      }
    }

    // Sort by fused score and take top-K
    const results = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ entry, score, sources }) => ({
        entry,
        score,
        sources: Array.from(sources),
      }));

    return results;
  }
}
