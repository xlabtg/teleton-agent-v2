import { describe, it, expect, beforeEach } from "vitest";
import { ImportanceScorer } from "../../packages/memory/src/importance-scorer.js";
import type { MemoryEntry } from "../../packages/core/src/domain/agent.interface.js";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: crypto.randomUUID(),
    content: "test memory",
    importance: 0.5,
    createdAt: new Date(),
    accessedAt: new Date(),
    tags: [],
    ...overrides,
  };
}

describe("ImportanceScorer", () => {
  let scorer: ImportanceScorer;

  beforeEach(() => {
    scorer = new ImportanceScorer();
  });

  it("should return a score between 0 and 1", () => {
    const entry = makeEntry();
    const score = scorer.score(entry);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("should give higher score to recently accessed entries", () => {
    const recent = makeEntry({ accessedAt: new Date() });
    const old = makeEntry({
      accessedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    expect(scorer.score(recent)).toBeGreaterThan(scorer.score(old));
  });

  it("should give higher score to frequently accessed entries", () => {
    const entry = makeEntry();

    const lowFreqScore = scorer.score(entry, { accessCount: 1 });
    const highFreqScore = scorer.score(entry, { accessCount: 10 });

    expect(highFreqScore).toBeGreaterThan(lowFreqScore);
  });

  it("should boost score for pinned entries", () => {
    const entry = makeEntry();

    const unpinnedScore = scorer.score(entry, { isPinned: false });
    const pinnedScore = scorer.score(entry, { isPinned: true });

    expect(pinnedScore).toBeGreaterThan(unpinnedScore);
  });

  it("should track access counts", () => {
    scorer.recordAccess("mem-1");
    scorer.recordAccess("mem-1");
    scorer.recordAccess("mem-1");

    expect(scorer.getAccessCount("mem-1")).toBe(3);
    expect(scorer.getAccessCount("mem-2")).toBe(0);
  });

  it("should support pin/unpin", () => {
    scorer.pin("mem-1");
    expect(scorer.isPinned("mem-1")).toBe(true);

    scorer.unpin("mem-1");
    expect(scorer.isPinned("mem-1")).toBe(false);
  });

  it("should use internal pin state when context not provided", () => {
    const entry = makeEntry();
    const basePinned = scorer.score(entry);

    scorer.pin(entry.id);
    const afterPin = scorer.score(entry);

    expect(afterPin).toBeGreaterThan(basePinned);
  });
});
