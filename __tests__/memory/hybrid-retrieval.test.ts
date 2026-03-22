import { describe, it, expect, vi, beforeEach } from "vitest";
import { HybridRetrieval } from "../../packages/memory/src/hybrid-retrieval.js";
import type { SemanticSearch } from "../../packages/memory/src/semantic-search.js";
import type { MemoryRepository } from "../../packages/core/src/ports/repository.port.js";
import type { MemoryEntry } from "../../packages/core/src/domain/agent.interface.js";

function makeEntry(id: string, content: string): MemoryEntry {
  return {
    id,
    content,
    importance: 0.5,
    createdAt: new Date(),
    accessedAt: new Date(),
    tags: [],
  };
}

describe("HybridRetrieval", () => {
  let semanticSearch: SemanticSearch;
  let memoryRepo: MemoryRepository;
  let retrieval: HybridRetrieval;

  beforeEach(() => {
    semanticSearch = {
      search: vi.fn().mockResolvedValue([]),
      searchByEmbedding: vi.fn().mockResolvedValue([]),
      index: vi.fn(),
      indexBatch: vi.fn(),
      removeFromIndex: vi.fn(),
    } as unknown as SemanticSearch;

    memoryRepo = {
      store: vi.fn(),
      findById: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      searchByEmbedding: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      delete: vi.fn(),
      compact: vi.fn(),
    };

    retrieval = new HybridRetrieval(semanticSearch, memoryRepo);
  });

  it("should combine semantic and keyword results", async () => {
    const entryA = makeEntry("a", "machine learning");
    const entryB = makeEntry("b", "deep learning");
    const entryC = makeEntry("c", "neural networks");

    (semanticSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entry: entryA, score: 0.9 },
      { entry: entryB, score: 0.7 },
    ]);

    (memoryRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      entryB, // Also found by keyword
      entryC, // Only found by keyword
    ]);

    const results = await retrieval.search("learning");

    expect(results.length).toBeGreaterThan(0);
    // entryB should rank highest since it appears in both sources
    const ids = results.map((r) => r.entry.id);
    expect(ids).toContain("b");
  });

  it("should return results even when one source is empty", async () => {
    const entryA = makeEntry("a", "only semantic");

    (semanticSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entry: entryA, score: 0.8 },
    ]);

    const results = await retrieval.search("semantic query");
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe("a");
    expect(results[0].sources).toContain("semantic");
  });

  it("should respect topK limit", async () => {
    const entries = Array.from({ length: 20 }, (_, i) => makeEntry(`e${i}`, `entry ${i}`));

    (semanticSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue(
      entries.map((e, i) => ({ entry: e, score: 1 - i * 0.05 }))
    );

    const results = await retrieval.search("test", { topK: 5 });
    expect(results).toHaveLength(5);
  });

  it("should mark sources correctly for overlapping results", async () => {
    const entryA = makeEntry("a", "overlap entry");

    (semanticSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entry: entryA, score: 0.9 },
    ]);
    (memoryRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue([entryA]);

    const results = await retrieval.search("overlap");
    expect(results).toHaveLength(1);
    expect(results[0].sources).toContain("semantic");
    expect(results[0].sources).toContain("keyword");
  });
});
