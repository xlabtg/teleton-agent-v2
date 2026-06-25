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
  /** Maximum number of responses retained in memory. */
  maxEntries?: number;
  /** Optional interval for automatic expired-entry eviction. */
  evictExpiredIntervalMs?: number;
}

/**
 * In-memory semantic response cache.
 * All cache reads/writes go through CacheKeyGenerator so that semantically
 * equivalent queries hit the same entry.
 */
export class PredictiveCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private evictionTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly keyGenerator: CacheKeyGenerator,
    private readonly metrics: CacheMetrics,
    config: PredictiveCacheConfig = {}
  ) {
    this.defaultTtlMs = config.defaultTtlMs ?? 5 * 60 * 1000; // 5 minutes
    this.maxEntries = config.maxEntries ?? 1_000;

    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("PredictiveCache maxEntries must be a positive integer");
    }

    if (config.evictExpiredIntervalMs !== undefined) {
      this.startEvictExpiredTimer(config.evictExpiredIntervalMs);
    }
  }

  /**
   * Look up a cached response for the given query.
   * Returns null on a miss or when the entry has expired.
   */
  async get(query: string): Promise<string | null> {
    const key = await this.keyGenerator.getKey(query);
    this.dropEvictedKeyEntries();
    const entry = this.store.get(key);

    if (!entry) {
      this.metrics.recordMiss();
      return null;
    }

    if (entry.expiresAt < new Date()) {
      this.deleteEntry(key);
      this.metrics.recordMiss();
      return null;
    }

    this.markRecentlyUsed(key, entry);
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
  async set(query: string, response: string, ttlMs?: number, fromWarming = false): Promise<void> {
    const key = await this.keyGenerator.getKey(query);
    this.dropEvictedKeyEntries();
    const now = new Date();
    const ttl = ttlMs ?? this.defaultTtlMs;

    const entry = {
      key,
      response,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      fromWarming,
    };

    this.store.delete(key);
    this.store.set(key, entry);
    this.evictOverflow();
  }

  /**
   * Explicitly remove a cache entry by query.
   */
  async invalidate(query: string): Promise<void> {
    const key = await this.keyGenerator.getKey(query);
    this.dropEvictedKeyEntries();
    this.deleteEntry(key);
  }

  /**
   * Remove all expired entries. Can be called periodically to reclaim memory.
   */
  evictExpired(): number {
    const now = new Date();
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) {
        this.deleteEntry(key);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Start periodically sweeping expired entries. Calling again replaces
   * the previous timer.
   */
  startEvictExpiredTimer(intervalMs: number): void {
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      throw new Error("PredictiveCache evictExpiredIntervalMs must be a positive integer");
    }

    this.stopEvictExpiredTimer();
    this.evictionTimer = setInterval(() => {
      this.evictExpired();
    }, intervalMs);
    this.evictionTimer.unref?.();
  }

  /** Stop the automatic expired-entry sweep, if one is running. */
  stopEvictExpiredTimer(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = undefined;
    }
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

  private dropEvictedKeyEntries(): void {
    for (const key of this.keyGenerator.drainEvictedKeys()) {
      this.store.delete(key);
    }
  }

  private markRecentlyUsed(key: string, entry: CacheEntry): void {
    this.store.delete(key);
    this.store.set(key, entry);
  }

  private evictOverflow(): void {
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.deleteEntry(oldestKey);
    }
  }

  private deleteEntry(key: string): void {
    this.store.delete(key);
    this.keyGenerator.deleteKey(key);
  }
}
