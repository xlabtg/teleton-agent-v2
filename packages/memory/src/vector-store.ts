/**
 * Vector store abstraction layer.
 * Supports multiple backends (in-memory, future: pgvector, Pinecone).
 * Provides cosine similarity search over embeddings.
 */

export interface VectorEntry {
  id: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorStoreOptions {
  dimensions: number;
  similarityThreshold?: number;
  maxEntries?: number;
}

export interface VectorStore {
  insert(entry: VectorEntry): Promise<void>;
  insertBatch(entries: VectorEntry[]): Promise<void>;
  search(query: number[], topK?: number, threshold?: number): Promise<VectorSearchResult[]>;
  delete(id: string): Promise<boolean>;
  size(): number;
  clear(): void;
}

/**
 * Computes cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 * Returns NaN when either vector has zero magnitude because similarity is undefined.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return Number.NaN;

  return dotProduct / magnitude;
}

/**
 * In-memory vector store using brute-force cosine similarity search.
 * Suitable for development and small-to-medium datasets.
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly entries = new Map<string, VectorEntry>();
  private readonly dimensions: number;
  private readonly defaultThreshold: number;
  private readonly maxEntries: number;

  constructor(options: VectorStoreOptions) {
    this.dimensions = options.dimensions;
    this.defaultThreshold = options.similarityThreshold ?? Number.NEGATIVE_INFINITY;
    this.maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
    if (
      this.maxEntries !== Number.POSITIVE_INFINITY &&
      (!Number.isInteger(this.maxEntries) || this.maxEntries < 1)
    ) {
      throw new Error("maxEntries must be a positive integer");
    }
  }

  async insert(entry: VectorEntry): Promise<void> {
    if (entry.embedding.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${entry.embedding.length}`
      );
    }
    if (this.entries.has(entry.id)) {
      this.entries.delete(entry.id);
    }
    this.entries.set(entry.id, entry);
    this.evictOldestEntries();
  }

  async insertBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.insert(entry);
    }
  }

  async search(
    query: number[],
    topK: number = 10,
    threshold?: number
  ): Promise<VectorSearchResult[]> {
    if (query.length !== this.dimensions) {
      throw new Error(`Query dimension mismatch: expected ${this.dimensions}, got ${query.length}`);
    }

    const minScore = threshold ?? this.defaultThreshold;
    const results: VectorSearchResult[] = [];

    for (const entry of this.entries.values()) {
      const score = cosineSimilarity(query, entry.embedding);
      if (Number.isFinite(score) && score >= minScore) {
        results.push({
          id: entry.id,
          score,
          metadata: entry.metadata,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private evictOldestEntries(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestId = this.entries.keys().next().value as string | undefined;
      if (oldestId === undefined) return;
      this.entries.delete(oldestId);
    }
  }
}
