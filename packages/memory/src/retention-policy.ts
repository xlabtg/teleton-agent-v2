/**
 * Retention policy with tiered storage.
 * Classifies memories into hot, warm, and cold tiers
 * based on their importance scores.
 */

import type { MemoryEntry } from "@teleton/core/domain/agent.interface.js";
import type { ImportanceScorer } from "./importance-scorer.js";

export type RetentionTier = "hot" | "warm" | "cold";

export interface RetentionThresholds {
  hotMinScore: number;
  warmMinScore: number;
  // Everything below warmMinScore is "cold"
}

export interface RetentionPolicyConfig {
  thresholds?: Partial<RetentionThresholds>;
  /** Maximum number of memories in the hot tier. */
  hotTierMaxSize?: number;
  /** Maximum number of memories in the warm tier. */
  warmTierMaxSize?: number;
}

export interface TierClassification {
  entry: MemoryEntry;
  tier: RetentionTier;
  score: number;
}

const DEFAULT_THRESHOLDS: RetentionThresholds = {
  hotMinScore: 0.6,
  warmMinScore: 0.3,
};

/**
 * Classifies memories into retention tiers based on importance scoring.
 */
export class RetentionPolicy {
  private readonly thresholds: RetentionThresholds;
  private readonly hotTierMaxSize: number;
  private readonly warmTierMaxSize: number;

  constructor(
    private readonly scorer: ImportanceScorer,
    config: RetentionPolicyConfig = {}
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
    this.hotTierMaxSize = config.hotTierMaxSize ?? 500;
    this.warmTierMaxSize = config.warmTierMaxSize ?? 2000;
  }

  /**
   * Classify a single memory entry into a retention tier.
   */
  classify(entry: MemoryEntry): TierClassification {
    const score = this.scorer.score(entry);
    return {
      entry,
      tier: this.scoreTier(score),
      score,
    };
  }

  /**
   * Classify and sort a batch of memory entries.
   * Returns classifications sorted by score descending,
   * with tier limits enforced.
   */
  classifyBatch(entries: MemoryEntry[]): TierClassification[] {
    const scored = entries.map((entry) => ({
      entry,
      score: this.scorer.score(entry),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    let hotCount = 0;
    let warmCount = 0;

    return scored.map(({ entry, score }) => {
      let tier = this.scoreTier(score);

      // Enforce tier size limits: overflow to lower tier
      if (tier === "hot" && hotCount >= this.hotTierMaxSize) {
        tier = "warm";
      }
      if (tier === "warm" && warmCount >= this.warmTierMaxSize) {
        tier = "cold";
      }

      if (tier === "hot") hotCount++;
      if (tier === "warm") warmCount++;

      return { entry, tier, score };
    });
  }

  /**
   * Get all entries that should be evicted (cold tier candidates).
   */
  getEvictionCandidates(entries: MemoryEntry[]): TierClassification[] {
    return this.classifyBatch(entries).filter((c) => c.tier === "cold");
  }

  private scoreTier(score: number): RetentionTier {
    if (score >= this.thresholds.hotMinScore) return "hot";
    if (score >= this.thresholds.warmMinScore) return "warm";
    return "cold";
  }
}
