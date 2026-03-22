/**
 * Predictive response cache — V2-05.
 * Stores pre-computed responses keyed semantically so that queries with
 * similar meaning can share a cached answer. Supports TTL expiration
 * and pluggable cache backends (in-memory by default, Redis-ready).
 */

import type { CacheKeyGenerator } from "./cache-key-generator.js";
import type { CacheMetrics } from "./cache-metrics.js";

export interface CacheEntry {
  key: string;
  response: string;
  createdAt: Date;
  expiresAt: Date;
  /** Whether this entry was pre-warmed (rather than populated on a real request). */
  fromWarming: boolean;
}

export interface PredictiveCacheConfig {
  /** Default TTL in milliseconds for cached entries. */
  defaultTtlMs?: number;
}

/**
 * In-memory semantic response cache.
 * All cache reads/writes go through CacheKeyGenerator so that semantically
 * equivalent queries hit the same entry.
 */
export class PredictiveCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly defaultTtlMs: number;

  constructor(
    private readonly keyGenerator: CacheKeyGenerator,
    private readonly metrics: CacheMetrics,
    config: PredictiveCacheConfig = {},
  ) {
    this.defaultTtlMs = config.defaultTtlMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Look up a cached response for the given query.
   * Returns null on a miss or when the entry has expired.
   */
  async get(query: string): Promise<string | null> {
    const key = await this.keyGenerator.getKey(query);
    const entry = this.store.get(key);

    if (!entry) {
      this.metrics.recordMiss();
      return null;
    }

    if (entry.expiresAt < new Date()) {
      this.store.delete(key);
      this.metrics.recordMiss();
      return null;
    }

    this.metrics.recordHit(0, entry.fromWarming);
    return entry.response;
  }

  /**
   * Store a response in the cache.
   * @param query   The query text that produced this response.
   * @param response  The response to cache.
   * @param ttlMs   Optional per-entry TTL override.
   * @param fromWarming  Mark the entry as pre-warmed (used in metrics).
   */
  async set(
    query: string,
    response: string,
    ttlMs?: number,
    fromWarming = false,
  ): Promise<void> {
    const key = await this.keyGenerator.getKey(query);
    const now = new Date();
    const ttl = ttlMs ?? this.defaultTtlMs;

    this.store.set(key, {
      key,
      response,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      fromWarming,
    });
  }

  /**
   * Explicitly remove a cache entry by query.
   */
  async invalidate(query: string): Promise<void> {
    const key = await this.keyGenerator.getKey(query);
    this.store.delete(key);
  }

  /**
   * Remove all expired entries. Can be called periodically to reclaim memory.
   */
  evictExpired(): number {
    const now = new Date();
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** Number of entries currently in the store (including potentially expired ones). */
  size(): number {
    return this.store.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
    this.keyGenerator.clear();
  }
}
