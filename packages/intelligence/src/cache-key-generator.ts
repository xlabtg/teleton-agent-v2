/**
 * Cache key generator.
 * Produces semantic cache keys from query embeddings so that queries with
 * similar meaning share the same cache entry rather than requiring exact
 * string equality.
 */

import type { EmbeddingProvider } from "@teleton/core/ports/service.port.js";

export interface CacheKeyGeneratorConfig {
  /**
   * Cosine-similarity threshold above which two queries are considered
   * semantically equivalent and share the same cache key. Range: 0–1.
   */
  similarityThreshold?: number;
}

export interface CacheKeyEntry {
  key: string;
  embedding: number[];
  query: string;
}

/**
 * Generates stable, semantic cache keys using embedding similarity.
 *
 * For each new query the generator:
 *  1. Computes its embedding.
 *  2. Compares it against all previously seen key embeddings.
 *  3. If a sufficiently similar embedding exists, reuses that key.
 *  4. Otherwise, mints a new key and stores the embedding for future lookups.
 */
export class CacheKeyGenerator {
  private readonly keys: CacheKeyEntry[] = [];
  private readonly similarityThreshold: number;

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    config: CacheKeyGeneratorConfig = {},
  ) {
    this.similarityThreshold = config.similarityThreshold ?? 0.92;
  }

  /**
   * Return (or create) a stable cache key for the given query.
   */
  async getKey(query: string): Promise<string> {
    const embedding = await this.embeddingProvider.embed(query);
    const match = this.findSimilar(embedding);

    if (match) return match.key;

    const key = `cache-${crypto.randomUUID()}`;
    this.keys.push({ key, embedding, query });
    return key;
  }

  /**
   * Return all registered key entries (useful for inspection / metrics).
   */
  getRegisteredKeys(): ReadonlyArray<CacheKeyEntry> {
    return this.keys;
  }

  /**
   * Clear all registered keys.
   */
  clear(): void {
    this.keys.length = 0;
  }

  private findSimilar(embedding: number[]): CacheKeyEntry | undefined {
    let bestScore = -Infinity;
    let bestEntry: CacheKeyEntry | undefined;

    for (const entry of this.keys) {
      const score = cosineSimilarity(embedding, entry.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (bestEntry && bestScore >= this.similarityThreshold) {
      return bestEntry;
    }
    return undefined;
  }
}

/**
 * Cosine similarity between two equal-length vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
