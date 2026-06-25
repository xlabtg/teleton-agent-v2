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
  /**
   * Maximum number of semantic keys retained for similarity scans.
   * The default bounds memory and scan cost while keeping a practical
   * working set for in-memory caching.
   */
  maxEntries?: number;
}

export interface CacheKeyEntry {
  key: string;
  embedding: number[];
  query: string;
  lastUsedAt: Date;
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
  private readonly evictedKeys: string[] = [];
  private readonly similarityThreshold: number;
  private readonly maxEntries: number;

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    config: CacheKeyGeneratorConfig = {}
  ) {
    this.similarityThreshold = config.similarityThreshold ?? 0.92;
    this.maxEntries = config.maxEntries ?? 1_000;

    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("CacheKeyGenerator maxEntries must be a positive integer");
    }
  }

  /**
   * Return (or create) a stable cache key for the given query.
   */
  async getKey(query: string): Promise<string> {
    const embedding = await this.embeddingProvider.embed(query);
    const match = this.findSimilar(embedding);

    if (match) {
      this.markRecentlyUsed(match);
      return match.key;
    }

    const key = `cache-${crypto.randomUUID()}`;
    this.keys.push({ key, embedding, query, lastUsedAt: new Date() });
    this.evictLeastRecentlyUsed();
    return key;
  }

  /**
   * Return all registered key entries (useful for inspection / metrics).
   */
  getRegisteredKeys(): ReadonlyArray<CacheKeyEntry> {
    return this.keys;
  }

  /**
   * Return and clear keys evicted since the previous drain.
   */
  drainEvictedKeys(): string[] {
    return this.evictedKeys.splice(0);
  }

  /**
   * Return keys evicted since the previous drain without clearing them.
   */
  getEvictedKeys(): readonly string[] {
    return this.evictedKeys;
  }

  /**
   * Remove a registered key and any pending eviction notification for it.
   */
  deleteKey(key: string): boolean {
    let deleted = false;

    for (let i = this.keys.length - 1; i >= 0; i--) {
      if (this.keys[i].key === key) {
        this.keys.splice(i, 1);
        deleted = true;
      }
    }

    for (let i = this.evictedKeys.length - 1; i >= 0; i--) {
      if (this.evictedKeys[i] === key) {
        this.evictedKeys.splice(i, 1);
      }
    }

    return deleted;
  }

  /**
   * Clear all registered keys.
   */
  clear(): void {
    this.keys.length = 0;
    this.evictedKeys.length = 0;
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

  private markRecentlyUsed(entry: CacheKeyEntry): void {
    entry.lastUsedAt = new Date();
    const index = this.keys.indexOf(entry);
    if (index >= 0) {
      this.keys.splice(index, 1);
      this.keys.push(entry);
    }
  }

  private evictLeastRecentlyUsed(): void {
    while (this.keys.length > this.maxEntries) {
      const [evicted] = this.keys.splice(0, 1);
      if (evicted) {
        this.evictedKeys.push(evicted.key);
      }
    }
  }
}

/**
 * Cosine similarity between two equal-length vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

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
