/**
 * Prediction engine — V2-04.
 * Anticipates likely next user actions based on historical behavioral patterns.
 * Operates fully rule-based (no ML dependency) so it can run with zero warm-up.
 * The architecture is designed to be swapped for an ML model later without
 * changing the public interface.
 */

import type { BehaviorTracker, ActionType } from "./behavior-tracker.js";
import type { PatternMiner, ActionPattern } from "./pattern-miner.js";
import type { PredictionEvaluator } from "./prediction-evaluator.js";

export interface Prediction {
  action: ActionType;
  confidence: number;
  supportingPattern: ActionPattern;
}

export interface PredictionEngineConfig {
  /** Minimum confidence score (0–1) for a prediction to be surfaced. */
  confidenceThreshold?: number;
  /** Maximum number of predictions to return per request. */
  maxPredictions?: number;
  /**
   * Number of recent events used as the "current context" window when
   * matching against mined patterns.
   */
  contextWindowSize?: number;
}

/**
 * Rule-based prediction engine.
 *
 * Algorithm:
 *  1. Fetch the user's recent event history from BehaviorTracker.
 *  2. Mine recurring sequences with PatternMiner.
 *  3. Find patterns whose tail matches the user's most-recent actions
 *     (the "current context").
 *  4. The next action in each matching pattern is the prediction.
 *  5. Rank by confidence × support; return predictions above threshold.
 */
export class PredictionEngine {
  private readonly confidenceThreshold: number;
  private readonly maxPredictions: number;
  private readonly contextWindowSize: number;

  constructor(
    private readonly behaviorTracker: BehaviorTracker,
    private readonly patternMiner: PatternMiner,
    private readonly evaluator: PredictionEvaluator,
    config: PredictionEngineConfig = {}
  ) {
    this.confidenceThreshold = config.confidenceThreshold ?? 0.4;
    this.maxPredictions = config.maxPredictions ?? 3;
    this.contextWindowSize = config.contextWindowSize ?? 3;
  }

  /**
   * Predict the most likely next action(s) for a user given their recent history.
   * Returns an empty array if the user has opted out, has too little history,
   * or no pattern meets the confidence threshold.
   */
  predict(userId: string): Prediction[] {
    if (this.behaviorTracker.isOptedOut(userId)) return [];

    const events = this.behaviorTracker.getEvents(userId);
    if (events.length === 0) return [];

    const patterns = this.patternMiner.mine(events);
    const context = events.slice(-this.contextWindowSize).map((e) => e.action);

    const candidates = this.findMatchingPredictions(patterns, context);

    // Apply threshold and limit
    return candidates
      .filter((p) => p.confidence >= this.confidenceThreshold)
      .slice(0, this.maxPredictions);
  }

  /**
   * Register a prediction in the evaluator and return its tracking id.
   * Call `feedback()` later with the actual observed action to close the loop.
   */
  predictAndTrack(userId: string): { predictions: Prediction[]; trackingIds: string[] } {
    const predictions = this.predict(userId);
    const trackingIds = predictions.map((p) =>
      this.evaluator.record(userId, p.action, p.confidence)
    );
    return { predictions, trackingIds };
  }

  /**
   * Close the feedback loop for a tracked prediction.
   */
  feedback(trackingId: string, actualAction: ActionType): void {
    this.evaluator.resolve(trackingId, actualAction);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Given mined patterns and the user's current action context, find patterns
   * whose prefix matches the context tail and return the predicted next action.
   *
   * A pattern [A, B, C] matches a context tail [A, B] and predicts C.
   */
  private findMatchingPredictions(patterns: ActionPattern[], context: ActionType[]): Prediction[] {
    // Map from predicted action → best candidate (highest confidence)
    const best = new Map<ActionType, Prediction>();

    for (const pattern of patterns) {
      const { sequence } = pattern;
      if (sequence.length < 2) continue;

      // Try matching the pattern's prefix against the context tail
      const prefix = sequence.slice(0, -1);
      const predictedAction = sequence[sequence.length - 1];

      if (!this.contextTailMatches(context, prefix)) continue;

      const existing = best.get(predictedAction);
      if (!existing || pattern.confidence > existing.confidence) {
        best.set(predictedAction, {
          action: predictedAction,
          confidence: pattern.confidence,
          supportingPattern: pattern,
        });
      }
    }

    return Array.from(best.values()).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Check whether the end of `context` contains `prefix` as a suffix.
   */
  private contextTailMatches(context: ActionType[], prefix: ActionType[]): boolean {
    if (prefix.length > context.length) return false;
    const tail = context.slice(-prefix.length);
    return prefix.every((action, i) => action === tail[i]);
  }
}
