import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryVectorStore, cosineSimilarity } from "../../packages/memory/src/vector-store.js";

describe("cosineSimilarity", () => {
  it("should return 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("should return 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("should return -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("should throw on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow("dimension mismatch");
  });

  it("should return NaN for zero-magnitude vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBeNaN();
    expect(cosineSimilarity([1, 2], [0, 0])).toBeNaN();
  });
});

describe("InMemoryVectorStore", () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore({ dimensions: 3 });
  });

  it("should insert and search entries", async () => {
    await store.insert({ id: "a", embedding: [1, 0, 0] });
    await store.insert({ id: "b", embedding: [0, 1, 0] });
    await store.insert({ id: "c", embedding: [0.9, 0.1, 0] });

    const results = await store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("a"); // Most similar
    expect(results[0].score).toBeCloseTo(1.0);
    expect(results[1].id).toBe("c"); // Second most similar
  });

  it("should respect threshold", async () => {
    await store.insert({ id: "a", embedding: [1, 0, 0] });
    await store.insert({ id: "b", embedding: [0, 1, 0] });

    const results = await store.search([1, 0, 0], 10, 0.5);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a");
  });

  it("should keep negative-similarity matches when no threshold is set", async () => {
    await store.insert({ id: "opposite", embedding: [-1, 0, 0] });
    await store.insert({ id: "less-opposite", embedding: [-0.5, -0.5, 0] });

    const results = await store.search([1, 0, 0], 10);
    expect(results.map((result) => result.id)).toEqual(["less-opposite", "opposite"]);
    expect(results[0].score).toBeLessThan(0);
    expect(results[1].score).toBeCloseTo(-1.0);
  });

  it("should skip zero-vector entries instead of ranking them as zero similarity", async () => {
    await store.insert({ id: "zero", embedding: [0, 0, 0] });
    await store.insert({ id: "opposite", embedding: [-1, 0, 0] });

    const results = await store.search([1, 0, 0], 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("opposite");
    expect(results[0].score).toBeCloseTo(-1.0);
  });

  it("should return no results for a zero-vector query", async () => {
    await store.insert({ id: "a", embedding: [1, 0, 0] });
    await store.insert({ id: "b", embedding: [-1, 0, 0] });

    await expect(store.search([0, 0, 0], 10)).resolves.toEqual([]);
  });

  it("should reject wrong dimensions on insert", async () => {
    await expect(store.insert({ id: "bad", embedding: [1, 2] })).rejects.toThrow(
      "dimension mismatch"
    );
  });

  it("should reject wrong dimensions on search", async () => {
    await expect(store.search([1, 2], 5)).rejects.toThrow("dimension mismatch");
  });

  it("should delete entries", async () => {
    await store.insert({ id: "a", embedding: [1, 0, 0] });
    expect(store.size()).toBe(1);

    const deleted = await store.delete("a");
    expect(deleted).toBe(true);
    expect(store.size()).toBe(0);

    const notDeleted = await store.delete("nonexistent");
    expect(notDeleted).toBe(false);
  });

  it("should handle batch insert", async () => {
    await store.insertBatch([
      { id: "a", embedding: [1, 0, 0] },
      { id: "b", embedding: [0, 1, 0] },
    ]);
    expect(store.size()).toBe(2);
  });

  it("should evict the oldest entries when maxEntries is reached", async () => {
    store = new InMemoryVectorStore({ dimensions: 3, maxEntries: 2 });

    await store.insert({ id: "a", embedding: [1, 0, 0] });
    await store.insert({ id: "b", embedding: [0, 1, 0] });
    await store.insert({ id: "c", embedding: [0, 0, 1] });

    expect(store.size()).toBe(2);
    const results = await store.search([1, 0, 0], 10);
    expect(results.map((result) => result.id)).not.toContain("a");
    expect(results.map((result) => result.id)).toEqual(expect.arrayContaining(["b", "c"]));
  });

  it("should refresh an existing entry's eviction order when overwritten", async () => {
    store = new InMemoryVectorStore({ dimensions: 3, maxEntries: 2 });

    await store.insert({ id: "a", embedding: [1, 0, 0] });
    await store.insert({ id: "b", embedding: [0, 1, 0] });
    await store.insert({ id: "a", embedding: [0.5, 0.5, 0] });
    await store.insert({ id: "c", embedding: [0, 0, 1] });

    const results = await store.search([1, 0, 0], 10);
    expect(results.map((result) => result.id)).toEqual(expect.arrayContaining(["a", "c"]));
    expect(results.map((result) => result.id)).not.toContain("b");
  });

  it("should include metadata in results", async () => {
    await store.insert({
      id: "a",
      embedding: [1, 0, 0],
      metadata: { tag: "test" },
    });

    const results = await store.search([1, 0, 0], 1);
    expect(results[0].metadata).toEqual({ tag: "test" });
  });

  it("should clear all entries", async () => {
    await store.insert({ id: "a", embedding: [1, 0, 0] });
    await store.insert({ id: "b", embedding: [0, 1, 0] });
    store.clear();
    expect(store.size()).toBe(0);
  });
});
