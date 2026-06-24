import { describe, expect, it, vi } from "vitest";
import { MemoryManager } from "../../packages/memory/src/memory-manager.js";
import type { MemoryEntry } from "../../packages/core/src/domain/agent.interface.js";
import type { EventBus } from "../../packages/core/src/domain/events.js";
import type { MemoryRepository } from "../../packages/core/src/ports/repository.port.js";
import type { MemoryCompaction } from "../../packages/memory/src/compaction.js";
import type { HybridRetrieval } from "../../packages/memory/src/hybrid-retrieval.js";
import type { ImportanceScorer } from "../../packages/memory/src/importance-scorer.js";
import type { RetentionPolicy } from "../../packages/memory/src/retention-policy.js";
import type { SemanticSearch } from "../../packages/memory/src/semantic-search.js";

function makeEntry(id: string): MemoryEntry {
  return {
    id,
    content: `memory ${id}`,
    importance: 0.1,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    accessedAt: new Date("2024-01-01T00:00:00Z"),
    tags: ["test"],
  };
}

describe("MemoryManager", () => {
  it("runs maintenance by listing memories instead of issuing an empty keyword search", async () => {
    const entries = [makeEntry("mem-1"), makeEntry("mem-2")];
    const memoryRepository = {
      store: vi.fn(),
      findById: vi.fn(),
      list: vi.fn().mockResolvedValue(entries),
      search: vi.fn().mockRejectedValue(new Error("empty FTS query should not be used")),
      searchByEmbedding: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      compact: vi.fn(),
    } satisfies MemoryRepository;
    const semanticSearch = { index: vi.fn() } as unknown as SemanticSearch;
    const hybridRetrieval = { search: vi.fn() } as unknown as HybridRetrieval;
    const scorer = { recordAccess: vi.fn() } as unknown as ImportanceScorer;
    const retentionPolicy = {
      getEvictionCandidates: vi.fn().mockReturnValue(entries.map((entry) => ({ entry }))),
    } as unknown as RetentionPolicy;
    const compaction = {
      compact: vi.fn().mockResolvedValue({ compactedCount: 2, summariesCreated: 1 }),
    } as unknown as MemoryCompaction;
    const eventBus = { publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() } as EventBus;

    const manager = new MemoryManager(
      memoryRepository,
      semanticSearch,
      hybridRetrieval,
      scorer,
      retentionPolicy,
      compaction,
      eventBus
    );

    await expect(manager.runMaintenance()).resolves.toEqual({
      compactedCount: 2,
      summariesCreated: 1,
    });
    expect(memoryRepository.list).toHaveBeenCalledWith(10000);
    expect(memoryRepository.search).not.toHaveBeenCalled();
    expect(retentionPolicy.getEvictionCandidates).toHaveBeenCalledWith(entries);
    expect(compaction.compact).toHaveBeenCalledWith(entries);
  });
});
