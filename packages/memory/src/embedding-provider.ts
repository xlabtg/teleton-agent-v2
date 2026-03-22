/**
 * Embedding provider abstraction.
 * Wraps the core EmbeddingProvider port with caching and batch support.
 */

import type { EmbeddingProvider } from "@teleton/core/ports/service.port.js";

export interface CachedEmbeddingProviderOptions {
  maxCacheSize?: number;
}

/**
 * Wraps an EmbeddingProvider with an LRU-style cache to avoid
 * redundant embedding calls for the same text.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  private readonly cache = new Map<string, number[]>();
  private readonly maxCacheSize: number;

  constructor(
    private readonly delegate: EmbeddingProvider,
    options: CachedEmbeddingProviderOptions = {}
  ) {
    this.maxCacheSize = options.maxCacheSize ?? 1000;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    const embedding = await this.delegate.embed(text);
    this.putCache(text, embedding);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    if (uncachedTexts.length > 0) {
      const embeddings = await this.delegate.embedBatch(uncachedTexts);
      for (let j = 0; j < uncachedIndices.length; j++) {
        const idx = uncachedIndices[j];
        results[idx] = embeddings[j];
        this.putCache(texts[idx], embeddings[j]);
      }
    }

    return results;
  }

  dimensions(): number {
    return this.delegate.dimensions();
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  private putCache(key: string, value: number[]): void {
    if (this.cache.size >= this.maxCacheSize) {
      // Evict oldest entry (first key in Map iteration order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}
