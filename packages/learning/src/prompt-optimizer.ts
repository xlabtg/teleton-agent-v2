/**
 * Prompt optimizer — V2-20.
 * Implements a gradient-free optimization loop that proposes the
 * best-performing template version based on outcome scores from
 * PromptTracker.
 *
 * The algorithm is intentionally simple and conservative:
 *  1. Compute the mean score for each version of a template.
 *  2. If a non-active version outperforms the active version by at least
 *     `minImprovementDelta`, record it as a promotion candidate.
 *  3. A human-readable diff between the old and new template is generated
 *     to aid review before promotions are explicitly approved.
 *
 * Safety:
 *  - Promotions are never applied by optimize(); an explicit approval step
 *    must call applyPromotionCandidate().
 *  - Templates must be opted in before they are eligible for candidates.
 *  - Applied promotions are recorded with a full audit trail so they can be
 *    reverted.
 */

import type { PromptRegistry } from "./prompt-registry.js";
import type { PromptTracker } from "./prompt-tracker.js";

export interface OptimizationResult {
  templateKey: string;
  previousVersion: number | null;
  promotedVersion: number;
  previousScore: number | null;
  newScore: number;
  /** Simple line-level diff between old and new template text. */
  diff: string;
  optimizedAt: Date;
  /** Whether the candidate has been explicitly applied to the registry. */
  applied: boolean;
  /** Time the candidate was applied, if approved. */
  appliedAt: Date | null;
}

export interface OptimizationRun {
  id: string;
  startedAt: Date;
  completedAt: Date;
  /** Historical name retained for callers; these are pending candidates. */
  promotions: OptimizationResult[];
  promotionCandidates: OptimizationResult[];
  skippedKeys: string[];
}

export interface PromptOptimizerConfig {
  /**
   * Minimum score improvement required to promote a new version.
   * Prevents noisy micro-improvements from triggering unnecessary changes.
   */
  minImprovementDelta?: number;
  /**
   * Minimum number of outcome records a version must have before it is
   * considered for promotion (avoids promoting on insufficient data).
   */
  minSampleSize?: number;
  /** Template keys that must never be auto-promoted. */
  safetyCriticalKeys?: string[];
  /**
   * Template keys eligible for optimization candidates. Empty means no keys
   * are eligible, keeping promotion decisions default-deny.
   */
  promotionEligibleKeys?: string[];
}

/** Produce a minimal line-level diff (added/removed lines) between two texts. */
function simpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const removed = oldLines.filter((l) => !newLines.includes(l)).map((l) => `- ${l}`);
  const added = newLines.filter((l) => !oldLines.includes(l)).map((l) => `+ ${l}`);
  return [...removed, ...added].join("\n") || "(no textual differences)";
}

/**
 * Optimization engine that compares prompt version performance and promotes
 * winners automatically.
 */
export class PromptOptimizer {
  private readonly registry: PromptRegistry;
  private readonly tracker: PromptTracker;
  private readonly minImprovementDelta: number;
  private readonly minSampleSize: number;
  private readonly safetyCriticalKeys: Set<string>;
  private readonly promotionEligibleKeys: Set<string>;
  private readonly runs: OptimizationRun[] = [];

  constructor(
    registry: PromptRegistry,
    tracker: PromptTracker,
    config: PromptOptimizerConfig = {}
  ) {
    this.registry = registry;
    this.tracker = tracker;
    this.minImprovementDelta = config.minImprovementDelta ?? 0.05;
    this.minSampleSize = config.minSampleSize ?? 10;
    this.safetyCriticalKeys = new Set(config.safetyCriticalKeys ?? []);
    this.promotionEligibleKeys = new Set(config.promotionEligibleKeys ?? []);
  }

  /**
   * Run one optimization pass across all registered templates.
   * Returns a run record that includes every promotion candidate found and
   * every key that was skipped (with the reason encoded as a comment in the
   * skippedKeys array for observability).
   */
  optimize(): OptimizationRun {
    const startedAt = new Date();
    const promotionCandidates: OptimizationResult[] = [];
    const skippedKeys: string[] = [];

    for (const template of this.registry.list()) {
      const key = template.key;

      if (!this.promotionEligibleKeys.has(key)) {
        skippedKeys.push(`${key} (promotion not enabled)`);
        continue;
      }

      if (this.safetyCriticalKeys.has(key)) {
        skippedKeys.push(`${key} (safety-critical)`);
        continue;
      }

      const allStats = this.tracker.getVersionStats(key);
      if (allStats.length === 0) {
        skippedKeys.push(`${key} (no usage data)`);
        continue;
      }

      // Only consider versions with enough data
      const qualified = allStats.filter(
        (s) => s.scoredCount >= this.minSampleSize && s.meanScore !== null
      );
      if (qualified.length === 0) {
        skippedKeys.push(`${key} (insufficient sample size)`);
        continue;
      }

      // Find the best performing version
      const best = qualified.reduce((prev, cur) =>
        (cur.meanScore ?? 0) > (prev.meanScore ?? 0) ? cur : prev
      );

      // Find the current active version's score
      const currentActiveVersion = template.activeVersion;
      const currentStats = currentActiveVersion
        ? allStats.find((s) => s.version === currentActiveVersion)
        : null;
      const currentScore = currentStats?.meanScore ?? null;

      const bestScore = best.meanScore ?? 0;
      const delta = currentScore !== null ? bestScore - currentScore : bestScore;

      if (best.version === currentActiveVersion) {
        skippedKeys.push(`${key} (active version is already best)`);
        continue;
      }

      if (delta < this.minImprovementDelta) {
        skippedKeys.push(`${key} (delta ${delta.toFixed(3)} below threshold)`);
        continue;
      }

      // Compute diff for review
      const oldTemplateText =
        currentActiveVersion !== null
          ? (this.registry.getVersion(key, currentActiveVersion)?.template ?? "")
          : "";
      const newTemplateText = this.registry.getVersion(key, best.version)?.template ?? "";
      const diff = simpleDiff(oldTemplateText, newTemplateText);

      promotionCandidates.push({
        templateKey: key,
        previousVersion: currentActiveVersion,
        promotedVersion: best.version,
        previousScore: currentScore,
        newScore: bestScore,
        diff,
        optimizedAt: new Date(),
        applied: false,
        appliedAt: null,
      });
    }

    const run: OptimizationRun = {
      id: crypto.randomUUID(),
      startedAt,
      completedAt: new Date(),
      promotions: promotionCandidates,
      promotionCandidates,
      skippedKeys,
    };

    this.runs.push(run);
    return run;
  }

  /** Return all past optimization runs, newest first. */
  getRunHistory(): OptimizationRun[] {
    return [...this.runs].reverse();
  }

  /** Return the most recent run, or null if none have been executed. */
  getLastRun(): OptimizationRun | null {
    return this.runs.length > 0 ? this.runs[this.runs.length - 1] : null;
  }

  /** Mark a template key as safety-critical (will never be auto-promoted). */
  markSafetyCritical(templateKey: string): void {
    this.safetyCriticalKeys.add(templateKey);
  }

  isSafetyCritical(templateKey: string): boolean {
    return this.safetyCriticalKeys.has(templateKey);
  }

  /** Mark a template key as eligible for optimization candidates. */
  enablePromotionCandidates(templateKey: string): void {
    this.promotionEligibleKeys.add(templateKey);
  }

  isPromotionCandidateEnabled(templateKey: string): boolean {
    return this.promotionEligibleKeys.has(templateKey);
  }

  /**
   * Explicitly approve and apply a candidate produced by optimize().
   * This separates score aggregation from the mutating production change.
   */
  applyPromotionCandidate(candidate: OptimizationResult): OptimizationResult {
    if (!this.promotionEligibleKeys.has(candidate.templateKey)) {
      throw new Error(`Promotion candidates are not enabled for '${candidate.templateKey}'`);
    }
    if (this.safetyCriticalKeys.has(candidate.templateKey)) {
      throw new Error(`Template '${candidate.templateKey}' is safety-critical`);
    }

    this.registry.promote(candidate.templateKey, candidate.promotedVersion);
    candidate.applied = true;
    candidate.appliedAt = new Date();
    return candidate;
  }
}
