/**
 * Importance scoring for memories.
 * Combines multiple signals to compute a composite importance score:
 * - Recency: How recently was this memory accessed?
 * - Frequency: How often has this memory been accessed?
 * - Content signals: Emotional weight, explicit pins
 */

import type { MemoryEntry } from "@teleton/core/domain/agent.interface.js";

export interface ImportanceWeights {
  recency: number;
  frequency: number;
  contentSignal: number;
  pinBoost: number;
}

export interface ScoringContext {
  accessCount: number;
  isPinned: boolean;
  contentSignalScore?: number;
}

const DEFAULT_WEIGHTS: ImportanceWeights = {
  recency: 0.3,
  frequency: 0.25,
  contentSignal: 0.25,
  pinBoost: 0.2,
};

/**
 * Scores memory entries by importance using configurable weights.
 */
export class ImportanceScorer {
  private readonly weights: ImportanceWeights;
  private readonly accessCounts = new Map<string, number>();
  private readonly pinnedIds = new Set<string>();

  constructor(weights: Partial<ImportanceWeights> = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Compute the importance score for a memory entry.
   * Returns a value between 0 and 1.
   */
  score(entry: MemoryEntry, context?: Partial<ScoringContext>): number {
    const accessCount = context?.accessCount ?? this.accessCounts.get(entry.id) ?? 1;
    const isPinned = context?.isPinned ?? this.pinnedIds.has(entry.id);
    const contentSignal = context?.contentSignalScore ?? 0.5;

    const recencyScore = this.computeRecency(entry.accessedAt);
    const frequencyScore = this.computeFrequency(accessCount);
    const pinScore = isPinned ? 1.0 : 0.0;

    const raw =
      this.weights.recency * recencyScore +
      this.weights.frequency * frequencyScore +
      this.weights.contentSignal * contentSignal +
      this.weights.pinBoost * pinScore;

    return Math.min(1.0, Math.max(0.0, raw));
  }

  /**
   * Record an access event for a memory.
   */
  recordAccess(memoryId: string): void {
    const current = this.accessCounts.get(memoryId) ?? 0;
    this.accessCounts.set(memoryId, current + 1);
  }

  /**
   * Pin a memory to boost its importance.
   */
  pin(memoryId: string): void {
    this.pinnedIds.add(memoryId);
  }

  /**
   * Unpin a memory.
   */
  unpin(memoryId: string): void {
    this.pinnedIds.delete(memoryId);
  }

  /**
   * Check if a memory is pinned.
   */
  isPinned(memoryId: string): boolean {
    return this.pinnedIds.has(memoryId);
  }

  /**
   * Get the access count for a memory.
   */
  getAccessCount(memoryId: string): number {
    return this.accessCounts.get(memoryId) ?? 0;
  }

  /**
   * Recency score: exponential decay based on time since last access.
   * Half-life of ~7 days.
   */
  private computeRecency(accessedAt: Date): number {
    const ageMs = Date.now() - accessedAt.getTime();
    const halfLifeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    return Math.exp((-Math.LN2 * ageMs) / halfLifeMs);
  }

  /**
   * Frequency score: logarithmic scaling of access count.
   * Normalized so that 10+ accesses approaches 1.0.
   */
  private computeFrequency(accessCount: number): number {
    return Math.min(1.0, Math.log(accessCount + 1) / Math.log(11));
  }
}
