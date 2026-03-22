/**
 * Cache metrics collector.
 * Tracks hit/miss counts, latency savings, and estimated cost reduction
 * for the predictive response cache.
 */

export interface CacheMetricsSnapshot {
  hits: number;
  misses: number;
  hitRate: number;
  /** Accumulated latency saved in milliseconds. */
  totalLatencySavedMs: number;
  /** Average latency saved per cache hit, in milliseconds. */
  avgLatencySavedMs: number;
  /** Number of pre-warming operations that produced a subsequent hit. */
  warmingHits: number;
  /** Number of pre-warming operations that never produced a hit. */
  warmingMisses: number;
}

/**
 * Simple in-memory metrics store for the predictive cache.
 */
export class CacheMetrics {
  private hits = 0;
  private misses = 0;
  private totalLatencySavedMs = 0;
  private warmingHits = 0;
  private warmingMisses = 0;

  /** Record a cache hit. `latencySavedMs` is the time saved vs a full pipeline run. */
  recordHit(latencySavedMs = 0, fromWarming = false): void {
    this.hits++;
    this.totalLatencySavedMs += latencySavedMs;
    if (fromWarming) {
      this.warmingHits++;
    }
  }

  /** Record a cache miss. */
  recordMiss(wasWarmed = false): void {
    this.misses++;
    if (wasWarmed) {
      this.warmingMisses++;
    }
  }

  /** Return a read-only snapshot of the current metrics. */
  snapshot(): CacheMetricsSnapshot {
    const total = this.hits + this.misses;
    const hitRate = total === 0 ? 0 : this.hits / total;
    const avgLatencySavedMs = this.hits === 0 ? 0 : this.totalLatencySavedMs / this.hits;

    return {
      hits: this.hits,
      misses: this.misses,
      hitRate,
      totalLatencySavedMs: this.totalLatencySavedMs,
      avgLatencySavedMs,
      warmingHits: this.warmingHits,
      warmingMisses: this.warmingMisses,
    };
  }

  /** Reset all counters. */
  reset(): void {
    this.hits = 0;
    this.misses = 0;
    this.totalLatencySavedMs = 0;
    this.warmingHits = 0;
    this.warmingMisses = 0;
  }
}
