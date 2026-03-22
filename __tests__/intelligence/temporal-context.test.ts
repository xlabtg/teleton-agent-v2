import { describe, it, expect, beforeEach } from "vitest";
import { TemporalContext } from "../../packages/intelligence/src/temporal-context.js";

const NOW = new Date("2024-06-15T12:00:00Z");

function makeContext() {
  return new TemporalContext({ referenceDate: NOW });
}

describe("TemporalContext", () => {
  let ctx: TemporalContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("should add and retrieve an item", () => {
    const item = ctx.add({ content: "hello", timestamp: NOW });
    expect(item.id).toBeTruthy();
    expect(ctx.get(item.id)).toEqual(item);
    expect(ctx.size).toBe(1);
  });

  it("should assign fresh score of ~1 for current timestamp", () => {
    const item = ctx.add({ content: "fresh", timestamp: NOW });
    expect(ctx.scoreOf(item)).toBeCloseTo(1, 5);
  });

  it("should assign lower score for older items", () => {
    const old = ctx.add({
      content: "old",
      timestamp: new Date(NOW.getTime() - 48 * 3_600_000), // 2 days ago
    });
    const fresh = ctx.add({ content: "fresh", timestamp: NOW });
    expect(ctx.scoreOf(old)).toBeLessThan(ctx.scoreOf(fresh));
  });

  it("should retrieve items sorted by score descending", () => {
    ctx.add({ content: "old", timestamp: new Date(NOW.getTime() - 2 * 86_400_000) });
    ctx.add({ content: "fresh", timestamp: NOW });
    const results = ctx.retrieve();
    expect(results[0].item.content).toBe("fresh");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("should filter retrieve by tag", () => {
    ctx.add({ content: "note", timestamp: NOW, tag: "note" });
    ctx.add({ content: "event", timestamp: NOW, tag: "event" });
    const notes = ctx.retrieve({ tag: "note" });
    expect(notes).toHaveLength(1);
    expect(notes[0].item.tag).toBe("note");
  });

  it("should respect the limit option in retrieve", () => {
    for (let i = 0; i < 5; i++) {
      ctx.add({ content: `item ${i}`, timestamp: new Date(NOW.getTime() + i * 1000) });
    }
    expect(ctx.retrieve({ limit: 3 })).toHaveLength(3);
  });

  it("should evict the lowest-scoring item when maxItems is reached", () => {
    const small = new TemporalContext({ maxItems: 2, referenceDate: NOW });
    small.add({ content: "old", timestamp: new Date(NOW.getTime() - 10 * 86_400_000) });
    small.add({ content: "medium", timestamp: new Date(NOW.getTime() - 86_400_000) });
    small.add({ content: "fresh", timestamp: NOW });
    // One item should have been evicted; the oldest should be gone
    expect(small.size).toBe(2);
    const contents = small.retrieve().map((r) => r.item.content);
    expect(contents).not.toContain("old");
  });

  it("should remove items", () => {
    const item = ctx.add({ content: "to remove", timestamp: NOW });
    ctx.remove(item.id);
    expect(ctx.get(item.id)).toBeUndefined();
    expect(ctx.size).toBe(0);
  });

  it("pruneStale should remove items below the threshold score", () => {
    // Add an item 100 half-lives ago — score will be effectively 0
    ctx.add({
      content: "ancient",
      timestamp: new Date(NOW.getTime() - 100 * 24 * 3_600_000),
    });
    ctx.add({ content: "fresh", timestamp: NOW });
    const removed = ctx.pruneStale(0.001);
    expect(removed).toBe(1);
    expect(ctx.size).toBe(1);
  });

  it("extractAndAdd should create items from time expressions in text", () => {
    const items = ctx.extractAndAdd("Let's meet tomorrow and also in 2 hours");
    expect(items.length).toBeGreaterThan(0);
  });
});
