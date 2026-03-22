import { describe, it, expect, beforeEach } from "vitest";
import { ImportanceScorer } from "../../packages/memory/src/importance-scorer.js";
import { RetentionPolicy } from "../../packages/memory/src/retention-policy.js";
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

describe("RetentionPolicy", () => {
  let scorer: ImportanceScorer;
  let policy: RetentionPolicy;

  beforeEach(() => {
    scorer = new ImportanceScorer();
    policy = new RetentionPolicy(scorer);
  });

  it("should classify high-score entries as hot", () => {
    // Pin to get a high score
    const entry = makeEntry();
    scorer.pin(entry.id);
    for (let i = 0; i < 10; i++) scorer.recordAccess(entry.id);

    const classification = policy.classify(entry);
    expect(classification.tier).toBe("hot");
    expect(classification.score).toBeGreaterThanOrEqual(0.6);
  });

  it("should classify old unaccessed entries as cold", () => {
    const entry = makeEntry({
      accessedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
    });

    const classification = policy.classify(entry);
    expect(classification.tier).toBe("cold");
  });

  it("should classify batch and sort by score descending", () => {
    const entries = [
      makeEntry({
        id: "old",
        accessedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      }),
      makeEntry({ id: "recent" }),
    ];
    scorer.pin("recent");

    const classified = policy.classifyBatch(entries);
    expect(classified[0].score).toBeGreaterThanOrEqual(classified[1].score);
  });

  it("should enforce tier size limits", () => {
    const policy2 = new RetentionPolicy(scorer, {
      hotTierMaxSize: 1,
      warmTierMaxSize: 1,
    });

    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" }), makeEntry({ id: "c" })];
    // Pin all to force high scores
    for (const e of entries) {
      scorer.pin(e.id);
      for (let i = 0; i < 10; i++) scorer.recordAccess(e.id);
    }

    const classified = policy2.classifyBatch(entries);
    const hotCount = classified.filter((c) => c.tier === "hot").length;
    const warmCount = classified.filter((c) => c.tier === "warm").length;

    expect(hotCount).toBeLessThanOrEqual(1);
    expect(warmCount).toBeLessThanOrEqual(1);
  });

  it("should identify eviction candidates", () => {
    const entries = [
      makeEntry({
        id: "old",
        accessedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      }),
      makeEntry({ id: "recent" }),
    ];
    scorer.pin("recent");

    const candidates = policy.getEvictionCandidates(entries);
    expect(candidates.some((c) => c.entry.id === "old")).toBe(true);
    expect(candidates.some((c) => c.entry.id === "recent")).toBe(false);
  });
});
