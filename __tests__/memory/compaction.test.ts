import { describe, expect, it, vi } from "vitest";
import type { MemoryEntry } from "../../packages/core/src/domain/agent.interface.js";
import type { MemoryRepository } from "../../packages/core/src/ports/repository.port.js";
import { MemoryCompaction } from "../../packages/memory/src/compaction.js";
import { InMemoryGraphStore } from "../../packages/memory/src/graph-store.js";
import { ImportanceScorer } from "../../packages/memory/src/importance-scorer.js";
import { SemanticSearch } from "../../packages/memory/src/semantic-search.js";
import { InMemoryVectorStore } from "../../packages/memory/src/vector-store.js";
import type { EmbeddingProvider } from "../../packages/core/src/ports/service.port.js";

function makeEntry(id: string): MemoryEntry {
  return {
    id,
    content: `cold memory ${id}`,
    importance: 0.1,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    accessedAt: new Date("2024-01-01T00:00:00Z"),
    tags: ["cold"],
  };
}

describe("MemoryCompaction", () => {
  it("removes compacted memories from vector and graph indexes", async () => {
    const entries = [makeEntry("mem-1"), makeEntry("mem-2")];
    const stored = new Map(entries.map((entry) => [entry.id, entry]));
    const memoryRepository = {
      store: vi.fn(async (entry: Omit<MemoryEntry, "id">) => {
        const summary = { ...entry, id: "summary-1" };
        stored.set(summary.id, summary);
        return summary;
      }),
      findById: vi.fn(async (id: string) => stored.get(id) ?? null),
      list: vi.fn(),
      search: vi.fn(),
      searchByEmbedding: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async (id: string) => {
        stored.delete(id);
      }),
      compact: vi.fn(),
    } satisfies MemoryRepository;
    const embeddingProvider = {
      embed: vi.fn(async (text: string) => (text.includes("mem-1") ? [1, 0, 0] : [0, 1, 0])),
      embedBatch: vi.fn(async (texts: string[]) =>
        texts.map((text) => (text.includes("mem-1") ? [1, 0, 0] : [0, 1, 0]))
      ),
      dimensions: vi.fn(() => 3),
    } satisfies EmbeddingProvider;
    const vectorStore = new InMemoryVectorStore({ dimensions: 3 });
    const semanticSearch = new SemanticSearch(vectorStore, embeddingProvider, memoryRepository);
    const graphStore = new InMemoryGraphStore();
    const nodeToDelete = graphStore.addNode({
      type: "entity",
      label: "Cold entity",
      properties: { memoryId: "mem-1" },
    });
    const nodeToKeep = graphStore.addNode({
      type: "entity",
      label: "Warm entity",
      properties: { memoryId: "warm-1" },
    });
    graphStore.addEdge({
      sourceId: nodeToDelete.id,
      targetId: nodeToKeep.id,
      type: "related_to",
      weight: 1,
      properties: { memoryId: "mem-1" },
    });
    const scorer = new ImportanceScorer({
      recency: 0,
      frequency: 0,
      contentSignal: 0,
      pinBoost: 0,
    });
    const compaction = new MemoryCompaction(
      memoryRepository,
      scorer,
      async () => "summary",
      { minClusterSize: 2, maxAgeMs: 0 },
      { semanticSearch, graphStore }
    );

    await semanticSearch.indexBatch(entries);
    expect(vectorStore.size()).toBe(2);
    expect(graphStore.nodeCount()).toBe(2);
    expect(graphStore.edgeCount()).toBe(1);

    await expect(compaction.compact(entries)).resolves.toMatchObject({
      compactedCount: 2,
      summariesCreated: 1,
      deletedIds: ["mem-1", "mem-2"],
    });

    expect(vectorStore.size()).toBe(0);
    expect(graphStore.getNode(nodeToDelete.id)).toBeUndefined();
    expect(graphStore.getNode(nodeToKeep.id)).toBe(nodeToKeep);
    expect(graphStore.edgeCount()).toBe(0);
  });
});
