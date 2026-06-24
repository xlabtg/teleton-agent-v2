import { describe, it, expect, vi, beforeEach } from "vitest";
import { CachedEmbeddingProvider } from "../../packages/memory/src/embedding-provider.js";
import type { EmbeddingProvider } from "../../packages/core/src/ports/service.port.js";

describe("CachedEmbeddingProvider", () => {
  let delegate: EmbeddingProvider;
  let cached: CachedEmbeddingProvider;

  beforeEach(() => {
    delegate = {
      embed: vi.fn().mockResolvedValue([1, 2, 3]),
      embedBatch: vi.fn().mockResolvedValue([
        [1, 2, 3],
        [4, 5, 6],
      ]),
      dimensions: vi.fn().mockReturnValue(3),
    };
    cached = new CachedEmbeddingProvider(delegate);
  });

  it("should cache embed results", async () => {
    const r1 = await cached.embed("hello");
    const r2 = await cached.embed("hello");

    expect(r1).toEqual(r2);
    expect(delegate.embed).toHaveBeenCalledTimes(1);
  });

  it("should not cache different texts", async () => {
    await cached.embed("hello");
    await cached.embed("world");

    expect(delegate.embed).toHaveBeenCalledTimes(2);
  });

  it("should use cache for partial batch hits", async () => {
    // Pre-cache "hello"
    await cached.embed("hello");

    (delegate.embedBatch as ReturnType<typeof vi.fn>).mockResolvedValue([[7, 8, 9]]);

    const results = await cached.embedBatch(["hello", "world"]);

    expect(results[0]).toEqual([1, 2, 3]); // From cache
    expect(results[1]).toEqual([7, 8, 9]); // From delegate
    // Only "world" should be sent to delegate
    expect(delegate.embedBatch).toHaveBeenCalledWith(["world"]);
  });

  it("should delegate dimensions()", () => {
    expect(cached.dimensions()).toBe(3);
    expect(delegate.dimensions).toHaveBeenCalled();
  });

  it("should evict old entries when cache is full", async () => {
    const small = new CachedEmbeddingProvider(delegate, { maxCacheSize: 2 });

    await small.embed("a");
    await small.embed("b");
    expect(small.cacheSize).toBe(2);

    await small.embed("c");
    expect(small.cacheSize).toBe(2); // Evicted oldest

    // "a" was evicted, so re-embedding it should call delegate
    (delegate.embed as ReturnType<typeof vi.fn>).mockClear();
    await small.embed("a");
    expect(delegate.embed).toHaveBeenCalledWith("a");
  });

  it("should refresh recency on embed cache hits", async () => {
    const small = new CachedEmbeddingProvider(delegate, { maxCacheSize: 2 });

    await small.embed("a");
    await small.embed("b");
    await small.embed("a");
    await small.embed("c");

    (delegate.embed as ReturnType<typeof vi.fn>).mockClear();
    await small.embed("a");
    expect(delegate.embed).not.toHaveBeenCalled();

    await small.embed("b");
    expect(delegate.embed).toHaveBeenCalledWith("b");
  });

  it("should refresh recency on embedBatch cache hits", async () => {
    const small = new CachedEmbeddingProvider(delegate, { maxCacheSize: 2 });

    await small.embed("a");
    await small.embed("b");
    await small.embedBatch(["a"]);
    await small.embed("c");

    (delegate.embed as ReturnType<typeof vi.fn>).mockClear();
    await small.embed("a");
    expect(delegate.embed).not.toHaveBeenCalled();

    await small.embed("b");
    expect(delegate.embed).toHaveBeenCalledWith("b");
  });

  it("should reject wrong-sized embeddings from embed", async () => {
    (delegate.embed as ReturnType<typeof vi.fn>).mockResolvedValue([1, 2]);

    await expect(cached.embed("bad")).rejects.toThrow(
      'Embedding dimension mismatch for text "bad": expected 3, received 2'
    );
    expect(cached.cacheSize).toBe(0);
  });

  it("should reject wrong-sized embeddings from embedBatch", async () => {
    (delegate.embedBatch as ReturnType<typeof vi.fn>).mockResolvedValue([
      [1, 2, 3],
      [4, 5],
    ]);

    await expect(cached.embedBatch(["ok", "bad"])).rejects.toThrow(
      'Embedding dimension mismatch for text "bad": expected 3, received 2'
    );
    expect(cached.cacheSize).toBe(0);
  });

  it("should clear cache", async () => {
    await cached.embed("hello");
    expect(cached.cacheSize).toBe(1);

    cached.clearCache();
    expect(cached.cacheSize).toBe(0);
  });
});
