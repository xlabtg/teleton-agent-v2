/**
 * Semantic search engine.
 * Uses embeddings + vector store to find semantically similar memories.
 */

import type { MemoryEntry } from "@teleton/core/domain/agent.interface.js";
import type { MemoryRepository } from "@teleton/core/ports/repository.port.js";
import type { EmbeddingProvider } from "@teleton/core/ports/service.port.js";
import type { VectorStore, VectorSearchResult } from "./vector-store.js";

export interface SemanticSearchOptions {
  topK?: number;
  threshold?: number;
}

export interface SemanticSearchResult {
  entry: MemoryEntry;
  score: number;
}

/**
 * Performs semantic similarity search over a memory repository
 * using vector embeddings.
 */
export class SemanticSearch {
  constructor(
    private readonly vectorStore: VectorStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly memoryRepository: MemoryRepository
  ) {}

  /**
   * Index a memory entry by generating and storing its embedding.
   */
  async index(entry: MemoryEntry): Promise<void> {
    const embedding = entry.embedding ?? (await this.embeddingProvider.embed(entry.content));

    await this.vectorStore.insert({
      id: entry.id,
      embedding,
      metadata: { tags: entry.tags },
    });
  }

  /**
   * Batch-index multiple memory entries.
   */
  async indexBatch(entries: MemoryEntry[]): Promise<void> {
    const textsToEmbed: string[] = [];
    const indicesToEmbed: number[] = [];

    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].embedding) {
        textsToEmbed.push(entries[i].content);
        indicesToEmbed.push(i);
      }
    }

    let newEmbeddings: number[][] = [];
    if (textsToEmbed.length > 0) {
      newEmbeddings = await this.embeddingProvider.embedBatch(textsToEmbed);
    }

    const embeddings: number[][] = new Array(entries.length);
    for (let j = 0; j < indicesToEmbed.length; j++) {
      embeddings[indicesToEmbed[j]] = newEmbeddings[j];
    }

    const vectorEntries = entries.map((entry, i) => {
      const embedding = entry.embedding ?? embeddings[i];

      return {
        id: entry.id,
        embedding,
        metadata: { tags: entry.tags },
      };
    });

    await this.vectorStore.insertBatch(vectorEntries);
  }

  /**
   * Search for semantically similar memories by text query.
   */
  async search(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const { topK = 10, threshold } = options;

    const queryEmbedding = await this.embeddingProvider.embed(query);
    const vectorResults = await this.vectorStore.search(queryEmbedding, topK, threshold);

    return this.resolveResults(vectorResults);
  }

  /**
   * Search by a pre-computed embedding vector.
   */
  async searchByEmbedding(
    embedding: number[],
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const { topK = 10, threshold } = options;
    const vectorResults = await this.vectorStore.search(embedding, topK, threshold);
    return this.resolveResults(vectorResults);
  }

  /**
   * Remove a memory entry from the vector index.
   */
  async removeFromIndex(id: string): Promise<void> {
    await this.vectorStore.delete(id);
  }

  private async resolveResults(
    vectorResults: VectorSearchResult[]
  ): Promise<SemanticSearchResult[]> {
    const results: SemanticSearchResult[] = [];

    for (const vr of vectorResults) {
      const entry = await this.memoryRepository.findById(vr.id);
      if (entry) {
        results.push({ entry, score: vr.score });
      }
    }

    return results;
  }
}
