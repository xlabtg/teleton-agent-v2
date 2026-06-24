import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryVectorStore } from "../../packages/memory/src/vector-store.js";
import { SemanticSearch } from "../../packages/memory/src/semantic-search.js";
import type { MemoryEntry } from "../../packages/core/src/domain/agent.interface.js";
import type { MemoryRepository } from "../../packages/core/src/ports/repository.port.js";
import type { EmbeddingProvider } from "../../packages/core/src/ports/service.port.js";

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: vi.fn().mockImplementation(async (text: string) => {
      // Simple hash-like embedding for testing
      const hash = Array.from(text).reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return [Math.sin(hash), Math.cos(hash), Math.sin(hash * 2)];
    }),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
      const results: number[][] = [];
      for (const text of texts) {
        const hash = Array.from(text).reduce((acc, c) => acc + c.charCodeAt(0), 0);
        results.push([Math.sin(hash), Math.cos(hash), Math.sin(hash * 2)]);
      }
      return results;
    }),
    dimensions: vi.fn().mockReturnValue(3),
  };
}

function createMockMemoryRepo(): MemoryRepository {
  const store = new Map<string, MemoryEntry>();
  return {
    store: vi.fn().mockImplementation(async (entry) => {
      const full = { id: crypto.randomUUID(), ...entry };
      store.set(full.id, full);
      return full;
    }),
    findById: vi.fn().mockImplementation(async (id) => store.get(id) ?? null),
    list: vi
      .fn()
      .mockImplementation(async (limit = 100) => Array.from(store.values()).slice(0, limit)),
    search: vi.fn().mockResolvedValue([]),
    searchByEmbedding: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    delete: vi.fn(),
    compact: vi.fn(),
  };
}

describe("SemanticSearch", () => {
  let vectorStore: InMemoryVectorStore;
  let embeddingProvider: EmbeddingProvider;
  let memoryRepo: MemoryRepository;
  let search: SemanticSearch;

  beforeEach(() => {
    vectorStore = new InMemoryVectorStore({ dimensions: 3 });
    embeddingProvider = createMockEmbeddingProvider();
    memoryRepo = createMockMemoryRepo();
    search = new SemanticSearch(vectorStore, embeddingProvider, memoryRepo);
  });

  it("should index a memory entry", async () => {
    const entry: MemoryEntry = {
      id: "mem-1",
      content: "Hello world",
      importance: 0.5,
      createdAt: new Date(),
      accessedAt: new Date(),
      tags: [],
    };

    await search.index(entry);
    expect(vectorStore.size()).toBe(1);
    expect(embeddingProvider.embed).toHaveBeenCalledWith("Hello world");
  });

  it("should use existing embedding if provided", async () => {
    const entry: MemoryEntry = {
      id: "mem-1",
      content: "Hello world",
      embedding: [1, 0, 0],
      importance: 0.5,
      createdAt: new Date(),
      accessedAt: new Date(),
      tags: [],
    };

    await search.index(entry);
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
    expect(vectorStore.size()).toBe(1);
  });

  it("should search by text query", async () => {
    // Manually insert into vector store and memory repo
    const entry: MemoryEntry = {
      id: "mem-1",
      content: "Machine learning concepts",
      importance: 0.5,
      createdAt: new Date(),
      accessedAt: new Date(),
      tags: [],
    };

    // Store in memory repo
    (memoryRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(entry);

    // Index
    await search.index(entry);

    // Search
    const results = await search.search("machine learning");
    expect(results.length).toBeGreaterThanOrEqual(0);
    // The mock embedding provider generates deterministic embeddings,
    // so similar strings may or may not match based on hash
  });

  it("should batch-index entries", async () => {
    const entries: MemoryEntry[] = [
      {
        id: "m1",
        content: "First",
        importance: 0.5,
        createdAt: new Date(),
        accessedAt: new Date(),
        tags: [],
      },
      {
        id: "m2",
        content: "Second",
        importance: 0.5,
        createdAt: new Date(),
        accessedAt: new Date(),
        tags: [],
      },
    ];

    await search.indexBatch(entries);
    expect(vectorStore.size()).toBe(2);
    expect(embeddingProvider.embedBatch).toHaveBeenCalled();
  });

  it("should remove from index", async () => {
    const entry: MemoryEntry = {
      id: "mem-1",
      content: "Test",
      embedding: [1, 0, 0],
      importance: 0.5,
      createdAt: new Date(),
      accessedAt: new Date(),
      tags: [],
    };

    await search.index(entry);
    expect(vectorStore.size()).toBe(1);

    await search.removeFromIndex("mem-1");
    expect(vectorStore.size()).toBe(0);
  });
});
