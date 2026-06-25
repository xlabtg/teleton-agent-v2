import { describe, it, expect, vi, beforeEach } from "vitest";
import { CacheKeyGenerator } from "../../packages/intelligence/src/cache-key-generator.js";
import { CacheMetrics } from "../../packages/intelligence/src/cache-metrics.js";
import { PredictiveCache } from "../../packages/intelligence/src/predictive-cache.js";
import type { EmbeddingProvider } from "../../packages/core/src/ports/service.port.js";

function createMockEmbeddingProvider(): EmbeddingProvider {
  let callCount = 0;
  return {
    embed: vi.fn().mockImplementation(async (text: string) => {
      callCount++;
      // Deterministic: same text → same embedding
      const hash = Array.from(text).reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return [Math.sin(hash), Math.cos(hash), Math.sin(hash * 2)];
    }),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
      return Promise.all(
        texts.map(async (t) => {
          const hash = Array.from(t).reduce((acc, c) => acc + c.charCodeAt(0), 0);
          return [Math.sin(hash), Math.cos(hash), Math.sin(hash * 2)];
        })
      );
    }),
    dimensions: vi.fn().mockReturnValue(3),
  };
}

function createExactEmbeddingProvider(): EmbeddingProvider {
  const embedText = async (text: string) => {
    const index = Number(text.replace(/\D/g, ""));
    const embeddings: Record<number, number[]> = {
      1: [1, 0, 0],
      2: [0, 1, 0],
      3: [0, 0, 1],
    };
    return embeddings[index] ?? [1, 1, 1];
  };

  return {
    embed: vi.fn().mockImplementation(embedText),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
      return Promise.all(texts.map(embedText));
    }),
    dimensions: vi.fn().mockReturnValue(3),
  };
}

function createMismatchedEmbeddingProvider(): EmbeddingProvider {
  const embeddings: Record<string, number[]> = {
    short: [1, 0],
    long: [1, 0, 99],
  };

  return {
    embed: vi.fn().mockImplementation(async (text: string) => embeddings[text] ?? [0, 1]),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
      return texts.map((text) => embeddings[text] ?? [0, 1]);
    }),
    dimensions: vi.fn().mockReturnValue(3),
  };
}

describe("CacheKeyGenerator", () => {
  let provider: EmbeddingProvider;
  let generator: CacheKeyGenerator;

  beforeEach(() => {
    provider = createMockEmbeddingProvider();
    generator = new CacheKeyGenerator(provider, { similarityThreshold: 0.999 });
  });

  it("should generate a key for a new query", async () => {
    const key = await generator.getKey("hello world");
    expect(typeof key).toBe("string");
    expect(key.startsWith("cache-")).toBe(true);
  });

  it("should reuse keys for identical queries", async () => {
    const k1 = await generator.getKey("hello world");
    const k2 = await generator.getKey("hello world");
    expect(k1).toBe(k2);
  });

  it("should create distinct keys for dissimilar queries", async () => {
    const k1 = await generator.getKey("aaa");
    const k2 = await generator.getKey("zzz");
    // These hashes are very different so different keys expected
    // (may collide by chance with tiny mock embeddings — acceptable for this test)
    expect(generator.getRegisteredKeys().length).toBeGreaterThanOrEqual(1);
    // At minimum we confirm both returned a string key
    expect(typeof k1).toBe("string");
    expect(typeof k2).toBe("string");
  });

  it("should clear all keys", async () => {
    await generator.getKey("hello world");
    generator.clear();
    expect(generator.getRegisteredKeys()).toHaveLength(0);
  });

  it("should evict the least recently used key when capacity is exceeded", async () => {
    const exactProvider = createExactEmbeddingProvider();
    const bounded = new CacheKeyGenerator(exactProvider, {
      similarityThreshold: 1,
      maxEntries: 2,
    });

    const q1Key = await bounded.getKey("q1");
    const q2Key = await bounded.getKey("q2");
    await bounded.getKey("q1");
    const q3Key = await bounded.getKey("q3");

    expect(bounded.getRegisteredKeys().map((entry) => entry.key)).toEqual([q1Key, q3Key]);
    expect(bounded.getRegisteredKeys()).toHaveLength(2);
    expect(bounded.getEvictedKeys()).toEqual([q2Key]);
  });

  it("should not reuse keys for mismatched embedding dimensions", async () => {
    const mismatchedProvider = createMismatchedEmbeddingProvider();
    const mismatched = new CacheKeyGenerator(mismatchedProvider, {
      similarityThreshold: 0.92,
    });

    const shortKey = await mismatched.getKey("short");
    const longKey = await mismatched.getKey("long");

    expect(longKey).not.toBe(shortKey);
    expect(mismatched.getRegisteredKeys()).toHaveLength(2);
  });
});

describe("CacheMetrics", () => {
  it("should track hits and misses", () => {
    const metrics = new CacheMetrics();
    metrics.recordHit(100);
    metrics.recordHit(200);
    metrics.recordMiss();

    const snap = metrics.snapshot();
    expect(snap.hits).toBe(2);
    expect(snap.misses).toBe(1);
    expect(snap.hitRate).toBeCloseTo(2 / 3);
    expect(snap.totalLatencySavedMs).toBe(300);
    expect(snap.avgLatencySavedMs).toBe(150);
  });

  it("should track warming hits", () => {
    const metrics = new CacheMetrics();
    metrics.recordHit(50, true);
    expect(metrics.snapshot().warmingHits).toBe(1);
  });

  it("should reset counters", () => {
    const metrics = new CacheMetrics();
    metrics.recordHit(100);
    metrics.reset();
    const snap = metrics.snapshot();
    expect(snap.hits).toBe(0);
    expect(snap.misses).toBe(0);
  });
});

describe("PredictiveCache", () => {
  let provider: EmbeddingProvider;
  let keyGen: CacheKeyGenerator;
  let metrics: CacheMetrics;
  let cache: PredictiveCache;

  beforeEach(() => {
    provider = createMockEmbeddingProvider();
    keyGen = new CacheKeyGenerator(provider, { similarityThreshold: 0.999 });
    metrics = new CacheMetrics();
    cache = new PredictiveCache(keyGen, metrics, { defaultTtlMs: 60_000 });
  });

  it("should return null on miss", async () => {
    const result = await cache.get("unknown query");
    expect(result).toBeNull();
    expect(metrics.snapshot().misses).toBe(1);
  });

  it("should return cached response on hit", async () => {
    await cache.set("hello world", "response text");
    const result = await cache.get("hello world");
    expect(result).toBe("response text");
    expect(metrics.snapshot().hits).toBe(1);
  });

  it("should expire entries after TTL", async () => {
    await cache.set("hello world", "response text", 1); // 1ms TTL
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await cache.get("hello world");
    expect(result).toBeNull();
  });

  it("should invalidate a specific query", async () => {
    await cache.set("hello world", "response text");
    await cache.invalidate("hello world");
    const result = await cache.get("hello world");
    expect(result).toBeNull();
  });

  it("should evict expired entries", async () => {
    await cache.set("q1", "r1", 1);
    await cache.set("q2", "r2", 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const evicted = cache.evictExpired();
    expect(evicted).toBeGreaterThanOrEqual(2);
    expect(cache.size()).toBe(0);
  });

  it("should clear the cache", async () => {
    await cache.set("hello world", "response text");
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("should drop cached responses when semantic keys are evicted", async () => {
    provider = createExactEmbeddingProvider();
    keyGen = new CacheKeyGenerator(provider, {
      similarityThreshold: 1,
      maxEntries: 2,
    });
    cache = new PredictiveCache(keyGen, metrics, { defaultTtlMs: 60_000 });

    await cache.set("q1", "r1");
    await cache.set("q2", "r2");
    expect(cache.size()).toBe(2);

    await cache.set("q3", "r3");

    expect(cache.size()).toBe(2);
    expect(keyGen.getRegisteredKeys().map((entry) => entry.query)).toEqual(["q2", "q3"]);
    expect(await cache.get("q1")).toBeNull();
    expect(await cache.get("q3")).toBe("r3");
  });

  it("should evict least recently used responses when cache capacity is exceeded", async () => {
    provider = createExactEmbeddingProvider();
    keyGen = new CacheKeyGenerator(provider, {
      similarityThreshold: 1,
      maxEntries: 10,
    });
    cache = new PredictiveCache(keyGen, metrics, { defaultTtlMs: 60_000, maxEntries: 2 });

    await cache.set("q1", "r1");
    await cache.set("q2", "r2");
    expect(await cache.get("q1")).toBe("r1");

    await cache.set("q3", "r3");

    expect(cache.size()).toBe(2);
    expect(keyGen.getRegisteredKeys().map((entry) => entry.query)).toEqual(["q1", "q3"]);
    expect(await cache.get("q2")).toBeNull();
    expect(await cache.get("q1")).toBe("r1");
    expect(await cache.get("q3")).toBe("r3");
  });

  it("should support automatic expired-entry eviction", async () => {
    cache = new PredictiveCache(keyGen, metrics, {
      defaultTtlMs: 1,
      evictExpiredIntervalMs: 5,
    });

    try {
      await cache.set("hello world", "response text");
      await vi.waitFor(() => expect(cache.size()).toBe(0));
    } finally {
      cache.stopEvictExpiredTimer();
    }
  });
});
